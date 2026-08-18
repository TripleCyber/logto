/**
 * La máquina de estados de la pantalla — **un marco no es una verdad** (CH-6).
 *
 * Portada de `tripleenable-api/src/navegador/maquina.js` y adaptada al sondeo: donde antes
 * llegaban marcos por un socket, ahora llegan por la respuesta de
 * `POST /api/experience/verification/te-channel/poll`. El problema es el mismo y por eso el
 * reductor también: en móvil, con la pestaña suspendida, una respuesta puede llegar tarde,
 * llegar dos veces o llegar de un sondeo anterior; y en el peor caso la escribe un XSS que ya
 * está dentro de la página. Aquí se decide qué se cree y qué no, y está separado de lo que
 * dibuja para poder atacarlo en un test sin navegador.
 *
 * Tres reglas, y las tres son de seguridad, no de comodidad:
 *
 *  1. **Los números de secuencia no retroceden.** Un marco `code` con un `seq` menor o igual al
 *     último visto es un reenvío: se ignora. Sin esto, un marco rancio repinta un QR muerto y la
 *     persona escanea un código que ya no lleva a ninguna parte.
 *  2. **Los estados terminales no se abandonan.** Aprobado, rechazado, caducado y fallido son
 *     finales. Volver de un terminal a «esperando» es exactamente lo que necesita quien quiera
 *     repintar un QR suyo sobre una sesión ajena.
 *  3. **`escaneado` tampoco vuelve atrás.** Una vez dicho «ya lo tenemos, termina en tu móvil»,
 *     ningún marco devuelve a la pantalla de escanear: sólo se puede avanzar a un terminal.
 *
 * Y la regla que no vive aquí porque no es del reductor: `aprobado` **notifica**, no autoriza. La
 * pantalla no avanza hasta que `POST …/confirm` responde que sí. Si `confirm` dice que no, el
 * marco era mentira.
 */

/** Un código del canal QR, tal y como lo devuelve el proxy. */
export type CodigoCanal = {
  readonly codeId: string;
  /** El URI que se pinta en el `<canvas>`. Nunca un PNG en data-URL: ver `qr-code.ts`. */
  readonly uri: string;
  readonly seq: number;
  readonly displayExpiresAt: string;
  readonly hardExpiresAt: string;
};

/** Unión cerrada de marcos, el reflejo en el cliente de la del servidor (`core/src/te/types.ts`). */
export type MarcoCanal =
  | { readonly t: 'code'; readonly code?: CodigoCanal }
  | { readonly t: 'claimed'; readonly seq?: number }
  | { readonly t: 'approved' }
  | { readonly t: 'rejected' }
  | { readonly t: 'expired' }
  | { readonly t: 'failed' };

export type NombreEstado =
  | 'inicio'
  | 'esperando'
  | 'escaneado'
  | 'aprobado'
  | 'rechazado'
  | 'caducado'
  | 'fallo';

export type EstadoCanal = {
  readonly nombre: NombreEstado;
  readonly seq: number;
  readonly codigo?: CodigoCanal;
};

export const estadoInicial: EstadoCanal = Object.freeze({ nombre: 'inicio', seq: 0 });

const terminales: ReadonlySet<NombreEstado> = new Set<NombreEstado>([
  'aprobado',
  'rechazado',
  'caducado',
  'fallo',
]);

export const esTerminal = (estado: EstadoCanal): boolean => terminales.has(estado.nombre);

/**
 * Analiza lo que vino por la red. `undefined` ante cualquier cosa que no encaje exactamente.
 *
 * No distingue «no es un objeto» de «es un objeto al que le falta un campo»: quien llama hace lo
 * mismo en los dos casos, y un solo camino de fallo evita que alguien añada un mensaje distinto
 * por cada uno — que es como se acaba construyendo un oráculo sin querer.
 */
export const analizarMarco = (datos: unknown): MarcoCanal | undefined => {
  if (typeof datos !== 'object' || datos === null) {
    return;
  }

  // `Reflect.get` en vez de un `as Record<string, unknown>`: lo que llega es de la red, y afirmar
  // su forma para poder leerla es justo lo que este analizador existe para no hacer.
  const campo = (clave: string): unknown => Reflect.get(datos, clave);

  switch (campo('t')) {
    case 'code': {
      const code = analizarCodigo(campo('code'));

      return code ? { t: 'code', code } : { t: 'code' };
    }
    case 'claimed': {
      const seq = campo('seq');

      return { t: 'claimed', seq: esSecuencia(seq) ? seq : undefined };
    }
    case 'approved': {
      return { t: 'approved' };
    }
    case 'rejected': {
      return { t: 'rejected' };
    }
    case 'expired': {
      return { t: 'expired' };
    }
    case 'failed': {
      return { t: 'failed' };
    }
    default: {
      return undefined;
    }
  }
};

export const analizarCodigo = (datos: unknown): CodigoCanal | undefined => {
  if (typeof datos !== 'object' || datos === null) {
    return;
  }

  const codeId: unknown = Reflect.get(datos, 'codeId');
  const uri: unknown = Reflect.get(datos, 'uri');
  const seq: unknown = Reflect.get(datos, 'seq');
  const displayExpiresAt: unknown = Reflect.get(datos, 'displayExpiresAt');
  const hardExpiresAt: unknown = Reflect.get(datos, 'hardExpiresAt');

  if (typeof codeId !== 'string' || codeId === '') {
    return;
  }

  if (typeof uri !== 'string' || uri === '') {
    return;
  }

  if (!esSecuencia(seq) || !esInstante(displayExpiresAt) || !esInstante(hardExpiresAt)) {
    return;
  }

  return { codeId, uri, seq, displayExpiresAt, hardExpiresAt };
};

const esSecuencia = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isInteger(valor) && valor > 0;

const esInstante = (valor: unknown): valor is string =>
  typeof valor === 'string' && !Number.isNaN(Date.parse(valor));

/**
 * Aplica un marco. Devuelve **el mismo objeto** cuando el marco se ignora, para que quien dibuja
 * sepa por identidad si hay algo que repintar.
 */
export const aplicar = (estado: EstadoCanal, marco: MarcoCanal): EstadoCanal => {
  if (esTerminal(estado)) {
    return estado;
  }

  /*
   * Los terminales **conservan el último código**, y no es un descuido de limpieza.
   *
   * La pantalla lo necesita para poder velarlo en vez de dejar un marco vacío: un hueco no dice
   * nada, y un código cubierto dice a la vez «esto estaba vivo» y «se puede revivir». Antes se
   * tiraba aquí, así que al llegar a un terminal la pantalla se quedaba literalmente sin nada que
   * pintar y el velo habría sido imposible.
   *
   * Conservarlo no lo revive: `esTerminal` sigue cortando la rotación y el sondeo, y quien dibuja
   * sólo lo enseña bajo el velo. Es el último dato conocido, no una promesa de que sirva.
   */
  switch (marco.t) {
    case 'approved': {
      return { nombre: 'aprobado', seq: estado.seq, codigo: estado.codigo };
    }
    case 'rejected': {
      return { nombre: 'rechazado', seq: estado.seq, codigo: estado.codigo };
    }
    case 'expired': {
      return { nombre: 'caducado', seq: estado.seq, codigo: estado.codigo };
    }
    case 'failed': {
      return { nombre: 'fallo', seq: estado.seq, codigo: estado.codigo };
    }
    case 'claimed': {
      // Regla 3: de `escaneado` sólo se sale hacia un terminal.
      if (estado.nombre === 'escaneado') {
        return estado;
      }

      const seq = marco.seq ?? estado.seq;

      return seq < estado.seq ? estado : { nombre: 'escaneado', seq };
    }
    case 'code': {
      if (estado.nombre === 'escaneado') {
        return estado;
      }

      // Un marco `code` sin código es «sigo esperando, nada nuevo»: mantiene el estado y con él
      // el código que ya se está pintando.
      if (!marco.code) {
        return estado.nombre === 'esperando'
          ? estado
          : { nombre: 'esperando', seq: estado.seq, codigo: estado.codigo };
      }

      // Regla 1: `<=` y no `<`. Un `seq` repetido es el mismo código otra vez, y repintarlo
      // reiniciaría la barra de tiempo sobre un código que lleva veinte segundos vivo — una
      // cuenta atrás que miente, que es OP-2 por la puerta de atrás.
      if (marco.code.seq <= estado.seq) {
        return estado;
      }

      return { nombre: 'esperando', seq: marco.code.seq, codigo: marco.code };
    }
  }
};
