import { InteractionEvent } from '@logto/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';

import { identifyAndSubmitInteraction } from '@/apis/experience';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import useSubmitInteractionErrorHandler from '@/hooks/use-submit-interaction-error-handler';

import {
  abrirCanalPush,
  abrirCanalQr,
  confirmarCanal,
  despacharPush,
  sondear,
  type DespachoPush,
  type RetoPush,
} from './api';
import { desfase, restanteMs } from './clock';
import { ritmoSinRedMs, techoSesionMs, topeReaperturas } from './config';
import { clasificarFallo, faseDesdeEstado, type FaseCanal } from './fases';
import {
  analizarMarco,
  aplicar,
  esTerminal,
  estadoInicial,
  type CodigoCanal,
  type EstadoCanal,
} from './machine';
import { comoTexto, numeroDeEmparejamiento } from './pairing';
import useIsMounted from './use-is-mounted';
import useRotacion from './use-rotacion';
import useSondeo from './use-sondeo';
import { crearLigadura, type LigaduraCanal } from './verifier';

export type { FaseCanal } from './fases';

/**
 * El motor de las pantallas del canal: abre, sondea, y redime.
 *
 * ## Sondeo, no socket
 *
 * El transporte es un sondeo corto con el ritmo dictado por el servidor. Encaja con la maquinaria
 * que la experiencia ya tiene y deja al servidor de Logto sin estado de larga vida: cada vuelta es
 * una petición y una respuesta. `retryAfterMs === 0` significa **parar**, no sondear sin pausa.
 *
 * Y es una cadena de `setTimeout`, no un `setInterval`. Con `setInterval` y un `await` dentro, una
 * respuesta lenta solapa peticiones, `clearInterval` no cancela la que está en vuelo y el paso a
 * `aprobado` puede ejecutarse dos veces. La cadena no puede solaparse por construcción: el
 * siguiente sondeo se programa cuando el anterior ha terminado.
 *
 * ## `approved` notifica, no autoriza (CH-6)
 *
 * El marco `approved` no mete a nadie en ningún sitio. Lo que decide es `POST …/confirm`: si
 * responde que no, el marco era mentira y la pantalla lo trata como un fallo.
 */

type Opciones = {
  /** `qr` liga el canal con un verifier; `push` despacha a un dispositivo. */
  readonly canal: 'qr' | 'push';
};

const useTeChannel = ({ canal }: Opciones) => {
  const [estado, setEstado] = useState<EstadoCanal>(estadoInicial);
  const [fase, setFase] = useState<FaseCanal>('inactivo');
  /**
   * ¿Ha dicho el canal en vivo, alguna vez, que alguien cogió el código?
   *
   * Existe para una regla de producto que no es de estilo: **no se pinta un fallo de acceso
   * mientras nadie haya escaneado**. Esperar no es fallar, y quien mira un código que no ha
   * tocado no puede leer «no se ha confirmado el acceso» sin concluir que algo está roto.
   *
   * La respuesta la da el canal y no un temporizador: `escaneado` es el marco `claimed`, y
   * `aprobado` es el marco `approved` —que implica un escaneo aunque el `claimed` se perdiera en
   * una vuelta suspendida—. Cualquier otra cosa (una vuelta del sondeo que se cae, el canal que
   * no llega a abrirse, el techo de sesión) ocurre **sin** que nadie haya hecho nada, y ahí el
   * único mensaje honesto es que el código no sirve y hay que pedir otro.
   */
  const [huboEscaneo, setHuboEscaneo] = useState(false);
  const [pairCode, setPairCode] = useState<string>();
  const [reto, setReto] = useState<RetoPush>();
  /** Se abre cuando un reto push termina mal: es la llave del selector de dispositivos (PU-12). */
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  /**
   * A dónde fue el aviso del push, enmascarado. `undefined` mientras no se sepa.
   *
   * Lo trae el sondeo y no el despacho, y eso no es una elección de esta pantalla: cuando el
   * despacho responde, el servidor todavía no ha resuelto el identificador —lo hace en un
   * trabajador de fondo, fuera del ciclo de petición, para que la latencia de esa respuesta no
   * diga si la cuenta existe (PU-4)—. Así que hay una ventana en la que la pantalla sabe que hay
   * un reto y **todavía no** a dónde fue, y esa ventana se dice, no se disimula.
   */
  const [despacho, setDespacho] = useState<DespachoPush>();

  /**
   * El verifier vive en memoria de la pestaña y sólo sale por la cabecera del canal. No se guarda
   * en `sessionStorage`: persistirlo convertiría un XSS de lectura en una toma de sesión.
   */
  const ligadura = useRef<LigaduraCanal>();
  const correccionReloj = useRef(0);
  const finDeSesion = useRef(0);

  /**
   * **La generación: el número de vidas que lleva este canal.**
   *
   * Cada apertura —la de montarse, la del botón, la de la reapertura automática— estrena una. La
   * cadena de sondeo se queda con la suya y se muere sola en cuanto deja de ser la vigente, así
   * que abrir de nuevo **cancela** lo anterior en vez de rezar para que ya hubiera terminado.
   *
   * Sustituye a un booleano `sondeando` que sólo sabía decir «hay una cadena viva» y no «¿de
   * quién?». Con él, un reintento durante un corte de red no arrancaba cadena —la vieja seguía
   * dormida esperando su turno— y la pantalla se quedaba mirando un canal que ya no existía. Con
   * la generación, la vieja despierta, ve que no es la vigente y se aparta.
   *
   * `sondeoActivo` guarda la generación de la cadena viva, o 0 si no hay ninguna: es lo que
   * impide que dos aperturas de la MISMA generación abran dos cadenas —la propiedad que ya tenía
   * el booleano y que no se puede perder—.
   */
  const generacion = useRef(0);
  const sondeoActivo = useRef(0);
  /** El temporizador de la reapertura automática tras un corte de red. */
  const reapertura = useRef<ReturnType<typeof setTimeout>>();
  /** Cuántas reaperturas automáticas se llevan gastadas en este corte. Ver `topeReaperturas`. */
  const reaperturasHechas = useRef(0);
  /**
   * Lo último que abrió canal, con sus argumentos ya dentro.
   *
   * Es lo que repite el botón de reintento y la reapertura automática, y por eso ninguna de las
   * dos necesita saber si esta pantalla es de QR o de push, ni a qué dispositivo iba el push.
   */
  const ultimaApertura = useRef<() => Promise<void>>();

  /**
   * La máquina vive en una `ref` y se **refleja** en el estado de React, no al revés.
   *
   * El motivo es concreto: el actualizador funcional de `setState` no se ejecuta cuando se llama,
   * sino durante el siguiente render. Reduciendo ahí dentro y leyendo el resultado a continuación
   * se leía siempre el estado anterior, y la transición a un estado terminal —que es lo que
   * decide si se redime, si se para el sondeo y si se desbloquea el selector de dispositivos—
   * no llegaba a verse nunca.
   */
  const estadoRef = useRef<EstadoCanal>(estadoInicial);

  const fijarEstado = useCallback((nuevo: EstadoCanal) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    estadoRef.current = nuevo;
    setEstado(nuevo);

    // Dentro de una sesión sólo sube; volver a `inicio` es un canal nuevo —lo hace `abrirQr` y
    // `abrirPush` al reintentar— y entonces la sesión anterior deja de contar.
    if (nuevo.nombre === 'escaneado' || nuevo.nombre === 'aprobado') {
      setHuboEscaneo(true);
    } else if (nuevo.nombre === 'inicio') {
      setHuboEscaneo(false);
    }
  }, []);

  const estaMontado = useIsMounted();
  const handleError = useErrorHandler();
  const redirectTo = useGlobalRedirectTo();
  const asyncIdentifyAndSubmit = useApi(identifyAndSubmitInteraction, { silent: true });

  /** ¿Sigue mandando esta generación? Si no, quien pregunte tiene que apartarse en silencio. */
  const vigente = useCallback(
    (gen: number) => estaMontado() && generacion.current === gen,
    [estaMontado]
  );

  /**
   * Estrena generación. Es lo primero que hace cualquier apertura, y con ello **cancela** la
   * cadena de sondeo anterior y cualquier reapertura que estuviera programada.
   */
  const nuevaGeneracion = useCallback(() => {
    clearTimeout(reapertura.current);
    // eslint-disable-next-line @silverhand/fp/no-mutation
    reapertura.current = undefined;
    // eslint-disable-next-line @silverhand/fp/no-mutation
    generacion.current += 1;

    return generacion.current;
  }, []);

  /**
   * Al desmontar, una generación más: lo que quede en vuelo se encuentra con que ya no manda y se
   * aparta sin tocar estado de React. Y el temporizador de reapertura se apaga, que si no
   * despertaría a abrir un canal para una pantalla que ya no está.
   */
  useEffect(
    () => () => {
      clearTimeout(reapertura.current);
      // eslint-disable-next-line @silverhand/fp/no-mutation
      generacion.current += 1;
    },
    []
  );

  /**
   * Todo lo que Logto pueda querer todavía —MFA, perfil obligatorio, alta de passkey— vuelve como
   * error de `submit`. Éste es el mismo manejador que usan sus propias pantallas, así que esos
   * flujos siguen aquí exactamente igual que tras una contraseña o un código.
   */
  const submitErrorHandler = useSubmitInteractionErrorHandler(InteractionEvent.SignIn, {
    replace: true,
  });

  /** Redime la verificación: es lo que crea la sesión de Logto. */
  const redimir = useCallback(async () => {
    setFase('confirmando');

    const confirmada = await confirmarCanal(ligadura.current?.verifier).catch(
      // `confirm` dijo que no; el motivo real ya está en el log del servidor.
      () => null
    );

    if (confirmada === null) {
      // `confirm` dijo que no. El marco `approved` no era una verdad.
      if (estaMontado()) {
        setFase('fallo');
      }

      return;
    }

    /*
     * La identificación va **con** el identificador de la verificación que acaba de devolver
     * `confirm`. Llamarla sin él —que es lo que se hacía— deja el cuerpo vacío y la ruta responde
     * `400 guard.invalid_input`: el canje del `code` había ido bien, la cartera había firmado, y
     * aun así la pantalla acababa en «no se pudo confirmar el acceso». Es exactamente lo que hace
     * el callback social de upstream (`signInWithSocial`), y por lo mismo: la interacción tiene
     * que saber cuál de sus verificaciones acredita a esta persona.
     */
    const [error, resultado] = await asyncIdentifyAndSubmit({
      verificationId: confirmada.verificationId,
    });

    if (error) {
      await handleError(error, submitErrorHandler);

      if (estaMontado()) {
        setFase('fallo');
      }

      return;
    }

    if (resultado?.redirectTo) {
      await redirectTo(resultado.redirectTo);
    }
  }, [asyncIdentifyAndSubmit, estaMontado, handleError, redirectTo, submitErrorHandler]);

  /**
   * Mete un código recién acuñado en la máquina.
   *
   * Lo llama `useRotacion`, que es quien decide **cuándo** hay que pedirlo. La máquina sigue
   * mandando: un `seq` que no avanza es un reenvío y `aplicar` devuelve el mismo objeto, así que
   * la identidad basta para saber si hay algo que repintar.
   */
  const aplicarCodigo = useCallback(
    (codigo: CodigoCanal) => {
      const siguiente = aplicar(estadoRef.current, { t: 'code', code: codigo });

      if (siguiente !== estadoRef.current) {
        fijarEstado(siguiente);
        setFase(faseDesdeEstado(siguiente));
      }
    },
    [fijarEstado]
  );

  /** Ver `use-rotacion.ts`: quien rota el código es la pantalla, y aquí está el porqué entero. */
  const rotar = useRotacion({
    canal,
    estado,
    estadoRef,
    ligadura,
    correccionReloj,
    estaMontado,
    aplicarCodigo,
  });

  /**
   * Una vuelta del sondeo. Devuelve los milisegundos hasta la siguiente, o `undefined` para parar.
   */
  const unaVuelta = useCallback(async (): Promise<number | undefined> => {
    const respuesta = await sondear(ligadura.current?.verifier);

    if (correccionReloj.current === 0) {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      correccionReloj.current = desfase(respuesta.cabeceraDate, Date.now());
    }

    /*
     * La etiqueta sólo se pisa cuando viene: el servidor la manda en cuanto despacha y la sigue
     * mandando en cada vuelta, pero una vuelta que la perdiera —un despliegue a medias, un marco
     * terminal servido por otra rama— no puede borrar de la pantalla lo que ya se dijo. Quien la
     * limpia es un despacho nuevo, en `despacharYEsperar`.
     */
    if (respuesta.despacho) {
      setDespacho(respuesta.despacho);
    }

    const marco = analizarMarco(respuesta.frame);

    if (!marco) {
      // Lo que no está en la unión cerrada no llega a la pantalla.
      return respuesta.retryAfterMs > 0 ? respuesta.retryAfterMs : undefined;
    }

    const siguienteEstado = aplicar(estadoRef.current, marco);

    // `aplicar` devuelve el MISMO objeto cuando el marco se ignora, así que la identidad basta
    // para saber si hay algo que repintar.
    if (siguienteEstado !== estadoRef.current) {
      fijarEstado(siguienteEstado);
    }

    if (esTerminal(siguienteEstado)) {
      if (siguienteEstado.nombre === 'aprobado') {
        await redimir();
      } else {
        setFase(faseDesdeEstado(siguienteEstado));
        // PU-12: la lista de dispositivos sólo se abre después de que un reto real haya fallado.
        // Ese fallo cuesta una notificación en la pantalla de bloqueo del titular, que es lo que
        // convierte enumerar en un evento de detección en vez de en reconocimiento gratis.
        if (canal === 'push') {
          setSelectorAbierto(true);
        }
      }

      return undefined;
    }

    setFase(faseDesdeEstado(siguienteEstado));

    return respuesta.retryAfterMs > 0 ? respuesta.retryAfterMs : undefined;
  }, [canal, fijarEstado, redimir]);

  /** Ver `use-sondeo.ts`: la cadena de vueltas, y por qué se cancela por generación. */
  const arrancarSondeo = useSondeo({
    unaVuelta,
    rotar,
    vigente,
    sondeoActivo,
    finDeSesion,
    estadoRef,
    setFase,
  });

  /**
   * Lo que se hace cuando la **apertura** tropieza, que es el agujero por el que se colaban F3 y F4.
   *
   * Antes esto era una línea —`setFase(error instanceof HTTPError ? 'fallo' : 'sinRed')`— y tenía
   * dos consecuencias medidas:
   *
   *  - con el login caducado, el 404 se contaba como «el canal no sirve» y la pantalla repintaba
   *    **la misma** que ya se estaba viendo: pulsar «Reintentar» parecía no hacer nada;
   *  - con un corte de red, quedaba «Sin conexión. Reintentando…» sin que nadie reintentara nada,
   *    porque el fallo había ocurrido **antes** de arrancar la cadena de sondeo. Ahí sólo se salía
   *    recargando, que es exactamente F4.
   *
   * Ahora cada caso tiene su salida: el login caducado se nombra, el corte de red se reabre solo
   * hasta un tope, y el canal muerto queda en `fallo` con el reintento en la mano.
   */
  const tropiezoAlAbrir = useCallback(
    async (gen: number, error: unknown) => {
      if (!vigente(gen)) {
        return;
      }

      const clase = await clasificarFallo(error);

      if (!vigente(gen)) {
        return;
      }

      setFase(clase);

      if (clase !== 'sinRed' || reaperturasHechas.current >= topeReaperturas) {
        return;
      }

      // eslint-disable-next-line @silverhand/fp/no-mutation
      reaperturasHechas.current += 1;
      // eslint-disable-next-line @silverhand/fp/no-mutation
      reapertura.current = setTimeout(() => {
        if (vigente(gen)) {
          void ultimaApertura.current?.();
        }
      }, ritmoSinRedMs);
    },
    [vigente]
  );

  /** Abre el canal QR: liga la pestaña, pinta el primer código y deriva el emparejamiento. */
  const abrirQr = useCallback(async () => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    ultimaApertura.current = abrirQr;

    const gen = nuevaGeneracion();

    setFase('abriendo');
    fijarEstado(estadoInicial);

    try {
      const nueva = await crearLigadura();

      if (!vigente(gen)) {
        return;
      }

      // eslint-disable-next-line @silverhand/fp/no-mutation
      ligadura.current = nueva;

      const apertura = await abrirCanalQr(nueva.channelHash);

      if (!vigente(gen)) {
        return;
      }

      // Se abrió: el corte de red, si lo hubo, se acabó, y el presupuesto de reaperturas vuelve
      // entero para el siguiente.
      // eslint-disable-next-line @silverhand/fp/no-mutation
      reaperturasHechas.current = 0;

      if (apertura.code) {
        fijarEstado({ nombre: 'esperando', seq: apertura.code.seq, codigo: apertura.code });
        setFase('esperando');
      }

      // eslint-disable-next-line @silverhand/fp/no-mutation
      finDeSesion.current =
        Date.now() +
        (apertura.expiresAt ? restanteMs(apertura.expiresAt, Date.now()) : techoSesionMs);

      if (apertura.sessionId) {
        const numero = await numeroDeEmparejamiento(apertura.sessionId, nueva.channelHashBytes);

        if (vigente(gen)) {
          setPairCode(comoTexto(numero));
        }
      }

      arrancarSondeo(gen);
    } catch (error: unknown) {
      await tropiezoAlAbrir(gen, error);
    }
  }, [arrancarSondeo, fijarEstado, nuevaGeneracion, tropiezoAlAbrir, vigente]);

  /**
   * El tramo común de push: despacha el reto, fija el techo de sesión y arranca el sondeo.
   *
   * Abrir y reintentar sólo se diferencian en si hay que abrir canal antes —de ahí `antes`—, y
   * tenerlo escrito dos veces ya había costado que una corrección entrara en una copia y no en la
   * otra. Lo que se comparte es exactamente lo que tiene que comportarse igual: el mismo techo, el
   * mismo arranque del sondeo y el mismo reparto entre «el servidor dijo que no» y «no hubo
   * servidor».
   */
  const despacharYEsperar = useCallback(
    async (deviceRef?: string, antes?: () => Promise<void>) => {
      const gen = nuevaGeneracion();

      setFase('abriendo');
      fijarEstado(estadoInicial);
      // Reto nuevo, destino nuevo. Arrastrar la etiqueta del anterior diría «enviado a tu
      // teléfono» de un aviso que todavía no ha salido — y, tras elegir otro dispositivo, diría
      // además el dispositivo equivocado.
      setDespacho(undefined);

      try {
        await antes?.();

        if (!vigente(gen)) {
          return;
        }

        const nuevoReto = await despacharPush(deviceRef);

        if (!vigente(gen)) {
          return;
        }

        // eslint-disable-next-line @silverhand/fp/no-mutation
        reaperturasHechas.current = 0;

        setReto(nuevoReto);
        fijarEstado({ nombre: 'esperando', seq: 0 });
        setFase('esperando');
        // eslint-disable-next-line @silverhand/fp/no-mutation
        finDeSesion.current = Date.now() + restanteMs(nuevoReto.expiresAt, Date.now());

        arrancarSondeo(gen);
      } catch (error: unknown) {
        await tropiezoAlAbrir(gen, error);
      }
    },
    [arrancarSondeo, fijarEstado, nuevaGeneracion, tropiezoAlAbrir, vigente]
  );

  /**
   * Abre el canal push y despacha. Sin `deviceRef` va al dispositivo elegible más reciente y no se
   * enseña ninguna lista: cero información antes de que nadie demuestre nada.
   */
  const abrirPush = useCallback(
    async (loginHint: string, deviceRef?: string) => {
      setReto(undefined);
      // eslint-disable-next-line @silverhand/fp/no-mutation
      ultimaApertura.current = async () => abrirPush(loginHint, deviceRef);

      return despacharYEsperar(deviceRef, async () => {
        await abrirCanalPush(loginHint);
      });
    },
    [despacharYEsperar]
  );

  /** Vuelve a despachar sobre el canal ya abierto, a otro dispositivo o al mismo. */
  const reintentarPush = useCallback(
    async (deviceRef?: string) => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      ultimaApertura.current = async () => reintentarPush(deviceRef);

      return despacharYEsperar(deviceRef);
    },
    [despacharYEsperar]
  );

  /**
   * Repite la última apertura, sea la que sea.
   *
   * Un solo botón para las dos pantallas y para los dos canales: quien dibuja no tiene que saber
   * si esto era un QR o un push, ni a qué dispositivo iba. Antes cada superficie llamaba a
   * `abrirQr` por su cuenta, y el push no tenía botón equivalente.
   */
  const reintentar = useCallback(async () => {
    await ultimaApertura.current?.();
  }, []);

  const { codigo } = estado;

  return {
    fase,
    estado,
    /** Ver la declaración: decide si la pantalla puede hablar de un acceso fallido. */
    huboEscaneo,
    codigo,
    pairCode,
    matchDigits: reto?.matchDigits,
    /** Ver la declaración: a dónde fue el aviso, o `undefined` mientras no se sepa. */
    despacho,
    expiraEn: reto?.expiresAt,
    selectorAbierto,
    correccionReloj: correccionReloj.current,
    abrirQr,
    abrirPush,
    reintentarPush,
    reintentar,
  };
};

export default useTeChannel;
