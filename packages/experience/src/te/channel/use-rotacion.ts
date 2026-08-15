import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';

import { rotarCodigo } from './api';
import { restanteMs } from './clock';
import { margenRotacionMs } from './config';
import { analizarCodigo, esTerminal, type CodigoCanal, type EstadoCanal } from './machine';
import { type LigaduraCanal } from './verifier';

/**
 * **Quien rota el código es la pantalla, no el servidor.**
 *
 * te-api acuña un código al abrir la sesión y **ninguno más por su cuenta**: `POST …/state` deriva
 * el marco de la fila activa, y en cuanto esa fila caduca no hay marco que derivar y la respuesta
 * pasa a ser un 4xx. Sin esta pieza, una pantalla de acceso a la que nadie toca se queda sin código
 * a los treinta segundos y anuncia un fallo del canal cuando lo único que ha pasado es que el
 * tiempo corre — que es justo lo que la pantalla no puede hacer. El propio módulo de rotación de
 * te-api lo da por supuesto al enumerar quién compite por el bloqueo de la sesión: «el temporizador
 * de la pantalla en `displayExpiresAt − 2 s`».
 *
 * Vive fuera de `use-te-channel` porque es otra pregunta: allí está la máquina —qué se cree de lo
 * que llega—, y aquí sólo **cuándo se pide el siguiente código y qué se hace con él**.
 *
 * ## Lo que llega se analiza igual que un marco
 *
 * `rotarCodigo` devuelve lo que dijo la red, y vale la misma regla que en el sondeo: lo que no
 * encaje exactamente en la forma esperada no llega a la pantalla. Se reusa `analizarCodigo` —el
 * mismo analizador que usa `analizarMarco`—, y el resultado entra por la máquina, con lo que la
 * regla de los números de secuencia (un `seq` que no avanza es un reenvío) cubre también esta
 * puerta.
 *
 * ## Silencio ante el fallo
 *
 * Una rotación que no sale **no pinta nada**. Quien dice la verdad del canal es el sondeo: si el
 * canal está muerto de verdad, la siguiente vuelta lo dirá con el marco que corresponda; y si fue
 * un tropiezo, el código de pantalla sigue sirviendo durante su gracia y no hay nada que contar.
 *
 * ## Dos rotaciones a la vez son la misma rotación
 *
 * Hay dos cosas que piden código: el temporizador de la cuenta atrás y la recuperación del sondeo,
 * y en el peor momento —al volver de una pestaña congelada— coinciden. te-api rechaza la segunda
 * por su antirráfaga (`TE_QR_ROTATE_MIN_SECONDS`), y ese rechazo, si le llegara a la recuperación,
 * se leería como «el canal está muerto» y pintaría un fallo sobre un canal que acababa de
 * renovarse. Por eso la llamada en vuelo se comparte: quien llega segundo espera el resultado del
 * primero en vez de gastar otra petición y otro código del presupuesto.
 */
type Opciones = {
  /** En push no hay código que pintar, así que no hay nada que rotar. */
  readonly canal: 'qr' | 'push';
  /** El estado de React: es lo que re-arma el temporizador con cada código nuevo. */
  readonly estado: EstadoCanal;
  /** El estado de la máquina, que va por delante del de React. Ver `use-te-channel`. */
  readonly estadoRef: MutableRefObject<EstadoCanal>;
  /** La ligadura de la pestaña. Su verifier es lo único que autoriza a rotar. */
  readonly ligadura: MutableRefObject<LigaduraCanal | undefined>;
  /** Desfase medido contra el reloj del servidor (OP-2). */
  readonly correccionReloj: MutableRefObject<number>;
  readonly estaMontado: () => boolean;
  /** Mete el código en la máquina. Devolver el estado a `use-te-channel` es cosa suya, no de aquí. */
  readonly aplicarCodigo: (codigo: CodigoCanal) => void;
};

const useRotacion = ({
  canal,
  estado,
  estadoRef,
  ligadura,
  correccionReloj,
  estaMontado,
  aplicarCodigo,
}: Opciones) => {
  const enVuelo = useRef<Promise<boolean>>();

  const rotarUnaVez = useCallback(async (): Promise<boolean> => {
    const verifier = ligadura.current?.verifier;

    // Sobre un terminal no se acuña nada, y sobre `escaneado` tampoco: la cartera ya tiene un
    // código y cambiarlo por otro sólo puede desemparejar las dos pantallas.
    if (
      !verifier ||
      esTerminal(estadoRef.current) ||
      estadoRef.current.nombre === 'escaneado' ||
      !estaMontado()
    ) {
      return false;
    }

    try {
      const codigo = analizarCodigo(await rotarCodigo(verifier));

      /*
       * `ligadura.current !== verifier` significa que mientras se pedía este código alguien
       * reintentó y abrió OTRA sesión. El código que acaba de llegar es de la sesión anterior y su
       * `seq` puede ser mayor que el de la nueva, así que la máquina lo dejaría pasar y la pantalla
       * pintaría un código muerto sobre un canal vivo. Se tira.
       */
      if (!codigo || !estaMontado() || ligadura.current?.verifier !== verifier) {
        return false;
      }

      aplicarCodigo(codigo);

      return true;
    } catch {
      return false;
    }
  }, [aplicarCodigo, estaMontado, estadoRef, ligadura]);

  const rotar = useCallback(async (): Promise<boolean> => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    enVuelo.current ||= (async () => {
      try {
        return await rotarUnaVez();
      } finally {
        // eslint-disable-next-line @silverhand/fp/no-mutation
        enVuelo.current = undefined;
      }
    })();

    return enVuelo.current;
  }, [rotarUnaVez]);

  /**
   * El temporizador: pide el código siguiente un pelo antes de que el de pantalla deje de pintarse.
   *
   * Cuelga del código que se está pintando, así que se re-arma solo con cada código nuevo —venga de
   * esta rotación o de un marco del sondeo— y se desarma solo al escanear, al llegar a un terminal
   * o al desmontar la pantalla. El instante sale de `displayExpiresAt`, que lo escribió el motor de
   * la base, corregido por el desfase medido (OP-2): un portátil adelantado no adelanta la rotación
   * de verdad.
   */
  useEffect(() => {
    if (canal !== 'qr' || estado.nombre !== 'esperando' || !estado.codigo) {
      return;
    }

    const espera = Math.max(
      0,
      restanteMs(estado.codigo.displayExpiresAt, Date.now() + correccionReloj.current) -
        margenRotacionMs
    );

    const temporizador = setTimeout(() => {
      void rotar();
    }, espera);

    return () => {
      clearTimeout(temporizador);
    };
  }, [canal, correccionReloj, estado, rotar]);

  return rotar;
};

export default useRotacion;
