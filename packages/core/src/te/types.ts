import { z } from 'zod';

/**
 * Contrato entre Logto y te-api, y entre Logto y el navegador.
 *
 * Los dos contratos son distintos a propósito: lo que te-api le cuenta a Logto no es lo que Logto
 * le cuenta al navegador. En medio hay una proyección con lista blanca (ver
 * {@link enmascararDispositivo}) para que un campo nuevo en te-api no se filtre solo hasta la
 * pantalla de acceso.
 */

/* ─────────────────────────── Interruptores de canal ─────────────────────────── */

export const interruptoresCanalGuard = z.object({
  qr: z.boolean(),
  push: z.boolean(),
});

export type InterruptoresCanal = z.infer<typeof interruptoresCanalGuard>;

/** Todo apagado. Es lo que se responde cuando te-api no contesta: fail-closed. */
export const interruptoresApagados: InterruptoresCanal = Object.freeze({ qr: false, push: false });

/* ─────────────────────────────── Canal QR ──────────────────────────────────── */

const codigoQrGuard = z.object({
  codeId: z.string(),
  /** URI que se pinta en el `<canvas>`. Nunca un PNG en data-URL: eso obligaría a abrir
   * `img-src data:` en la CSP de la experiencia, y la política de te-api existe justo para no
   * abrir esa rendija. */
  uri: z.string(),
  seq: z.number(),
  displayExpiresAt: z.string(),
  hardExpiresAt: z.string(),
});

type CodigoQr = z.infer<typeof codigoQrGuard>;

export const sesionQrGuard = z.object({
  sessionId: z.string(),
  /**
   * Lo que antes era la cookie `__Host-te_ch`. Deja de ser cookie porque el navegador ya no habla
   * con te-api: el secreto viaja en el cuerpo de la respuesta s2s y se queda en el almacén de la
   * interacción, del lado del servidor. La huella en `qr_session.cookie_fp` sigue igual; sólo
   * cambia el transporte.
   */
  channelSecret: z.string(),
  expiresAt: z.string(),
  code: codigoQrGuard,
});

export const transaccionGuard = z.object({
  txnId: z.string(),
  expiresAt: z.string(),
});

export const confirmacionGuard = z.object({
  /** URL de retorno con `code` y `state`. **Muere en el servidor de Logto.** */
  redirectTo: z.string(),
});

/* ───────────────────────────── Marcos de estado ────────────────────────────── */

/**
 * Unión cerrada de marcos. Se deriva de la fila en te-api (CH-6): ni histórico ni replay. Y
 * `approved` **notifica**, no autoriza: el cliente decide llamando a `confirm`, y si `confirm`
 * dice que no, el marco era mentira.
 */
export const marcoCanalGuard = z.discriminatedUnion('t', [
  z.object({ t: z.literal('code'), code: codigoQrGuard.optional() }),
  z.object({ t: z.literal('claimed'), seq: z.number().optional() }),
  z.object({ t: z.literal('approved') }),
  z.object({ t: z.literal('rejected') }),
  z.object({ t: z.literal('expired') }),
  z.object({ t: z.literal('failed') }),
]);

export type MarcoCanal = z.infer<typeof marcoCanalGuard>;

/**
 * Lo que te-api devuelve en el sondeo: el marco **envuelto**, junto al ritmo con el que hay que
 * volver.
 *
 * El envoltorio existe y hay que respetarlo. Analizar la respuesta directamente con
 * {@link marcoCanalGuard} —que es lo que este cliente hacía— falla siempre, porque el cuerpo no
 * tiene `t` en la raíz: el sondeo del QR y el del push devolvían el error uniforme del canal en
 * cada vuelta y ningún login llegaba a completarse. El fallo era invisible en los tests porque el
 * cliente estaba simulado en el borde y el simulacro devolvía el marco desnudo.
 *
 * El `retryAfterMs` de te-api se consume aquí y no se propaga: la tabla de ritmos vive en
 * {@link ritmoSondeoMs} y es la misma en los dos lados (1500/700/0). Tener un solo sitio donde se
 * decide qué se le dice al navegador es lo que impide que las dos tablas se separen sin que nadie
 * lo note.
 */
export const sondeoTeApiGuard = z.object({
  frame: marcoCanalGuard,
  retryAfterMs: z.number(),
});

/** Estados en los que ya no hay nada que esperar. El cliente para de sondear. */
export const estadosTerminales = new Set<MarcoCanal['t']>([
  'approved',
  'rejected',
  'expired',
  'failed',
]);

/**
 * Cadencia dictada por el servidor, no por el cliente.
 *
 * 1500 ms mientras se pinta el código: la rotación del QR es de 30 s, así que el sondeo la cubre
 * con dos órdenes de magnitud de margen. 700 ms una vez reclamado, que es cuando la persona está
 * mirando la pantalla esperando a que avance.
 */
export const ritmoSondeoMs = (marco: MarcoCanal): number => {
  switch (marco.t) {
    case 'claimed': {
      return 700;
    }
    case 'code': {
      return 1500;
    }
    default: {
      return 0;
    }
  }
};

/* ─────────────────────────── Canal push y dispositivos ─────────────────────── */

export const retoPushGuard = z.object({
  challengeId: z.string(),
  expiresAt: z.string(),
  /** Los dos dígitos que la persona teclea en la cartera (PU-1). */
  matchDigits: z.string(),
});

type RetoPush = z.infer<typeof retoPushGuard>;

const categoriaDispositivo = z.enum(['phone', 'tablet', 'desktop']);
const antiguedadDispositivo = z.enum(['today', 'this_week', 'older']);

/**
 * Dispositivo tal y como lo devuelve te-api. Deliberadamente **ya enmascarado en origen**: la
 * política de elegibilidad (confirmado, no revocado, no abandonado, push activo, visto
 * recientemente) y el orden por más reciente los impone te-api como invariantes de consulta, no
 * como filtro de aplicación. Un filtro en el cliente no es un filtro.
 */
const dispositivoTeApiGuard = z.object({
  deviceRef: z.string(),
  kind: z.string(),
  lastSeen: z.string(),
});

export const listaDispositivosGuard = z.object({
  devices: z.array(dispositivoTeApiGuard),
});

/** Lo único que puede llegar al navegador antes de que nadie apruebe nada. */
type DispositivoEnmascarado = {
  /** Opaco y ligado a este reto. No sirve para correlacionar entre sesiones. */
  deviceRef: string;
  kind: z.infer<typeof categoriaDispositivo>;
  lastSeen: z.infer<typeof antiguedadDispositivo>;
};

/** Tope de entradas. Más allá de 5, el número deja de ser una ayuda y pasa a ser un censo. */
export const topeDispositivos = 5;

/**
 * Proyección con lista blanca: se construye un objeto nuevo con exactamente tres claves en vez de
 * reenviar lo que llegó. Es la diferencia entre «hoy te-api no manda el nombre» y «el nombre no
 * puede llegar al navegador aunque te-api lo mande mañana».
 *
 * Una categoría desconocida se muestra como `phone`: la etiqueta es deliberadamente gruesa y
 * `phone` es la moda de la flota, así que es la que menos información añade. Una antigüedad
 * desconocida cae a `older`, que es la cubeta menos precisa.
 */
export const enmascararDispositivo = (bruto: {
  deviceRef: string;
  kind: string;
  lastSeen: string;
}): DispositivoEnmascarado => {
  const kind = categoriaDispositivo.safeParse(bruto.kind);
  const lastSeen = antiguedadDispositivo.safeParse(bruto.lastSeen);

  return {
    deviceRef: bruto.deviceRef,
    kind: kind.success ? kind.data : 'phone',
    lastSeen: lastSeen.success ? lastSeen.data : 'older',
  };
};

/* ───────────────────────── Respuestas hacia el navegador ───────────────────── */

export const respuestaConfigGuard = z.object({
  channels: interruptoresCanalGuard,
  devicePicker: z.enum(['lazy', 'eager']),
});

export const respuestaCanalGuard = z.object({
  verificationId: z.string(),
  sessionId: z.string(),
  expiresAt: z.string(),
  code: codigoQrGuard,
});

export const respuestaSondeoGuard = z.object({
  frame: marcoCanalGuard,
  retryAfterMs: z.number(),
});

export const respuestaDispositivosGuard = z.object({
  devices: z.array(
    z.object({
      deviceRef: z.string(),
      kind: categoriaDispositivo,
      lastSeen: antiguedadDispositivo,
    })
  ),
});
