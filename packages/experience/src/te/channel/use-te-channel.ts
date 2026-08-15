import { InteractionEvent } from '@logto/schemas';
import { HTTPError } from 'ky';
import { useCallback, useRef, useState } from 'react';

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
  type RetoPush,
} from './api';
import { desfase, restanteMs } from './clock';
import { ritmoInicialMs, ritmoSinRedMs, techoSesionMs } from './config';
import {
  analizarMarco,
  aplicar,
  esTerminal,
  estadoInicial,
  type CodigoCanal,
  type EstadoCanal,
  type NombreEstado,
} from './machine';
import { comoTexto, numeroDeEmparejamiento } from './pairing';
import useIsMounted from './use-is-mounted';
import useRotacion from './use-rotacion';
import { crearLigadura, type LigaduraCanal } from './verifier';

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

/** Lo que la pantalla necesita saber para dibujarse. */
export type FaseCanal =
  | 'inactivo'
  | 'abriendo'
  | 'esperando'
  | 'escaneado'
  | 'confirmando'
  | 'aprobado'
  | 'rechazado'
  | 'caducado'
  | 'fallo'
  | 'sinRed';

type Opciones = {
  /** `qr` liga el canal con un verifier; `push` despacha a un dispositivo. */
  readonly canal: 'qr' | 'push';
};

/**
 * De estado de la máquina a fase de pantalla, en tabla y no en `switch`.
 *
 * Es la misma forma que usa `TeStatus` para sus textos, y por el mismo motivo: una tabla se lee de
 * un vistazo y el compilador exige que estén los siete estados, así que añadir uno a la máquina y
 * olvidarse de la pantalla deja de compilar en vez de caer en un `default`.
 */
const fases: Readonly<Record<NombreEstado, FaseCanal>> = Object.freeze({
  inicio: 'abriendo',
  esperando: 'esperando',
  escaneado: 'escaneado',
  aprobado: 'aprobado',
  rechazado: 'rechazado',
  caducado: 'caducado',
  fallo: 'fallo',
});

const faseDesdeEstado = (estado: EstadoCanal): FaseCanal => fases[estado.nombre];

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
   * El verifier vive en memoria de la pestaña y sólo sale por la cabecera del canal. No se guarda
   * en `sessionStorage`: persistirlo convertiría un XSS de lectura en una toma de sesión.
   */
  const ligadura = useRef<LigaduraCanal>();
  const correccionReloj = useRef(0);
  const finDeSesion = useRef(0);
  const sondeando = useRef<boolean>(false);

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

  /** Arranca la cadena de sondeos. Idempotente: dos llamadas no abren dos cadenas. */
  const arrancarSondeo = useCallback(() => {
    if (sondeando.current) {
      return;
    }

    // eslint-disable-next-line @silverhand/fp/no-mutation
    sondeando.current = true;

    const vuelta = async () => {
      if (!estaMontado()) {
        return;
      }

      if (finDeSesion.current > 0 && Date.now() > finDeSesion.current) {
        /*
         * Techo absoluto: una pestaña olvidada no sondea para siempre si el servidor deja de
         * contestar del todo. La caducidad de verdad la dice el marco `expired`, así que antes de
         * rendirse se hace **una última vuelta**.
         *
         * No es cortesía: el techo se calcula desde el mismo `expiresAt` que usa el servidor, así
         * que llegaba siempre un instante antes que el marco `expired` y lo tapaba. Consecuencia
         * medida: tras un push que caduca, ni el servidor marcaba el reto como fallido ni la
         * pantalla abría el selector de dispositivos, así que «usar otro dispositivo» no aparecía
         * nunca y C3 se quedaba a medias. El desbloqueo del selector es un efecto del sondeo (PU-12,
         * se gana habiendo gastado un push real), y saltárselo era saltarse el desbloqueo.
         */
        try {
          await unaVuelta();
        } catch {
          setFase('caducado');
        }

        if (estaMontado() && !esTerminal(estadoRef.current)) {
          setFase('caducado');
        }

        // eslint-disable-next-line @silverhand/fp/no-mutation
        sondeando.current = false;

        return;
      }

      try {
        const espera = await unaVuelta();

        if (!estaMontado() || espera === undefined) {
          // eslint-disable-next-line @silverhand/fp/no-mutation
          sondeando.current = false;

          return;
        }

        setTimeout(() => {
          void vuelta();
        }, espera);
      } catch (error: unknown) {
        if (!estaMontado()) {
          // eslint-disable-next-line @silverhand/fp/no-mutation
          sondeando.current = false;

          return;
        }

        // Un 4xx del canal es el error uniforme: el canal ya no sirve y no hay nada que
        // reintentar. Un fallo sin respuesta es la red, y de eso sí se vuelve.
        if (error instanceof HTTPError) {
          /*
           * Antes de rendirse, una oportunidad: **el canal puede haberse quedado sin código sin
           * haberse muerto**. Los temporizadores de una pestaña en segundo plano se frenan a uno
           * por minuto, así que la rotación llega tarde, el código caduca del todo y el sondeo se
           * encuentra con una sesión viva de la que no se puede derivar ningún marco. Al volver a
           * la pestaña eso se veía como «este código no está listo» sin que nadie hubiera tocado
           * nada.
           *
           * Acuñar otro código es exactamente lo que falta, y la sesión —que dura mucho más que
           * un código— sigue siendo la misma. Si tampoco se puede acuñar, entonces sí: el canal
           * está muerto y se dice.
           */
          const revivido = await rotar();

          if (revivido && estaMontado()) {
            setTimeout(() => {
              void vuelta();
            }, ritmoInicialMs);

            return;
          }

          setFase('fallo');
          // eslint-disable-next-line @silverhand/fp/no-mutation
          sondeando.current = false;

          return;
        }

        setFase('sinRed');
        setTimeout(() => {
          void vuelta();
        }, ritmoSinRedMs);
      }
    };

    void vuelta();
  }, [estaMontado, rotar, unaVuelta]);

  /** Abre el canal QR: liga la pestaña, pinta el primer código y deriva el emparejamiento. */
  const abrirQr = useCallback(async () => {
    setFase('abriendo');
    fijarEstado(estadoInicial);

    try {
      const nueva = await crearLigadura();
      // eslint-disable-next-line @silverhand/fp/no-mutation
      ligadura.current = nueva;

      const apertura = await abrirCanalQr(nueva.channelHash);

      if (!estaMontado()) {
        return;
      }

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

        if (estaMontado()) {
          setPairCode(comoTexto(numero));
        }
      }

      arrancarSondeo();
    } catch (error: unknown) {
      if (estaMontado()) {
        setFase(error instanceof HTTPError ? 'fallo' : 'sinRed');
      }
    }
  }, [arrancarSondeo, estaMontado, fijarEstado]);

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
      setFase('abriendo');
      fijarEstado(estadoInicial);

      try {
        await antes?.();

        const nuevoReto = await despacharPush(deviceRef);

        if (!estaMontado()) {
          return;
        }

        setReto(nuevoReto);
        fijarEstado({ nombre: 'esperando', seq: 0 });
        setFase('esperando');
        // eslint-disable-next-line @silverhand/fp/no-mutation
        finDeSesion.current = Date.now() + restanteMs(nuevoReto.expiresAt, Date.now());

        arrancarSondeo();
      } catch (error: unknown) {
        if (estaMontado()) {
          setFase(error instanceof HTTPError ? 'fallo' : 'sinRed');
        }
      }
    },
    [arrancarSondeo, estaMontado, fijarEstado]
  );

  /**
   * Abre el canal push y despacha. Sin `deviceRef` va al dispositivo elegible más reciente y no se
   * enseña ninguna lista: cero información antes de que nadie demuestre nada.
   */
  const abrirPush = useCallback(
    async (loginHint: string, deviceRef?: string) => {
      setReto(undefined);

      return despacharYEsperar(deviceRef, async () => {
        await abrirCanalPush(loginHint);
      });
    },
    [despacharYEsperar]
  );

  /** Vuelve a despachar sobre el canal ya abierto, a otro dispositivo o al mismo. */
  const reintentarPush = useCallback(
    async (deviceRef?: string) => despacharYEsperar(deviceRef),
    [despacharYEsperar]
  );

  const { codigo } = estado;

  return {
    fase,
    estado,
    /** Ver la declaración: decide si la pantalla puede hablar de un acceso fallido. */
    huboEscaneo,
    codigo,
    pairCode,
    matchDigits: reto?.matchDigits,
    expiraEn: reto?.expiresAt,
    selectorAbierto,
    correccionReloj: correccionReloj.current,
    abrirQr,
    abrirPush,
    reintentarPush,
  };
};

export default useTeChannel;
