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

/**
 * La aplicación que **originó** el login: la RP, no Logto.
 *
 * Sin este campo la cartera enseña «Logto» en la pantalla de aprobación. Logto es la fontanería:
 * la persona no ha oído hablar de ella y lo que pulsó fue «entrar» en Care Store. El nombre que
 * te-api tiene a mano es el de `te.oauth_client`, y ahí sólo puede haber un cliente OAuth —el
 * conector de Logto, sembrado literalmente como `Logto`—, porque el conector se presenta ante
 * te-api con SU `client_id` y no con el de la RP. Nadie más que este proceso sabe cuál era.
 *
 * Todo menos `id` es opcional, y eso **es** el contrato: resolver el nombre y el logo de la
 * aplicación toca la base de datos, y un fallo ahí no puede tumbar un acceso. Lo peor que pasa es
 * que te-api caiga a lo de siempre. Ver `resolverAplicacionRp` en `#src/te/route-helpers.ts`.
 */
export type AplicacionRp = {
  /**
   * `applicationId` de Logto, leído de `ctx.interactionDetails.params.client_id`.
   *
   * Es **estado de servidor de oidc-provider**, recuperado de la interacción viva por
   * `koaInteractionDetails`, no un parámetro que el navegador vuelva a mandar en esta petición.
   * Esa propiedad es la que sostiene todo lo demás: te-api pinta este nombre en una pantalla de
   * aprobación, y un nombre elegido por quien ataca sería precisamente el ataque.
   */
  id: string;
  name?: string;
  /**
   * El origen que se **enseña**, derivado de los `redirect_uris` registrados de la aplicación.
   * Registrarlos es un acto de la consola, así que sigue siendo un dato del servidor.
   */
  origin?: string;
  logoUrl?: string;
};

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
 * El `retryAfterMs` de te-api **se propaga**, acotado por {@link acotarRitmoSondeo}. Antes se
 * consumía aquí y se recalculaba con una tabla propia idéntica a la de te-api; el comentario que
 * había en este mismo sitio avisaba de que las dos podían separarse sin que nadie lo notara. Se
 * quitó una: la que manda es te-api, donde vive el estado y donde el número es configurable.
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
 * Cadencia del sondeo: **la que dice te-api**, acotada.
 *
 * Antes había aquí una tabla propia (1500/700/0) idéntica a la de te-api, y un comentario que
 * avisaba de que las dos podían separarse sin que nadie lo notara. La forma de que no se separen
 * no es tener dos y vigilarlas: es tener una. te-api la decide porque es donde vive el estado y
 * donde el número es configurable (`TE_POLL_INTERVAL_MS`).
 *
 * Lo que queda aquí es la **acotación**, y no sobra: este número acaba en un `setTimeout` del
 * navegador. Un cero o un negativo por un despliegue mal puesto convertiría el sondeo en un bucle
 * cerrado contra el propio servidor, así que un ritmo positivo se sube al suelo de 1 s y se baja
 * al techo de 30 s.
 *
 * El **cero sigue significando parar** y por eso pasa tal cual: es un estado terminal, no un
 * ritmo, y confundirlo con «sondea muy rápido» sería justo el error que el suelo previene.
 */
export const acotarRitmoSondeo = (retryAfterMs: number): number => {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
    return 0;
  }

  return Math.min(30_000, Math.max(1000, Math.trunc(retryAfterMs)));
};
/* ─────────────────────────── Canal push y dispositivos ─────────────────────── */

const categoriaDispositivo = z.enum(['phone', 'tablet', 'desktop']);
const antiguedadDispositivo = z.enum(['today', 'this_week', 'older']);

/**
 * A dónde fue el aviso, enmascarado. Lo que la pantalla de espera puede decir.
 *
 * Llega por el **sondeo** y no por el despacho, y eso no es un capricho del transporte: cuando
 * `POST …/push` responde, te-api todavía no ha despachado nada. La resolución identificador →
 * sujeto → dispositivos ocurre en su trabajador de fondo justo para que la latencia del despacho
 * no diga si la cuenta existe (PU-4). Preguntar «¿a qué dispositivo?» en el momento del despacho
 * es pedirle al servidor que resuelva dentro del ciclo de petición, que es exactamente lo que esa
 * mitigación evita.
 *
 * `null` mientras no se ha despachado — para un reto real y para uno señuelo por igual.
 */
const despachoTeApiGuard = z.object({
  count: z.number(),
  kind: z.string().optional(),
  lastSeen: z.string().optional(),
});

/** Lo que te-api dice. **No es lo que ve el navegador**: en medio va {@link enmascararDespacho}. */
export type DespachoTeApi = z.infer<typeof despachoTeApiGuard>;

/** Lo único de la etiqueta que puede llegar al navegador. */
type DespachoPush = {
  /** Cuántos destinos recibieron el aviso. */
  count: number;
  /** Sólo con un destino. Con abanico te-api lo omite: sería entregar la lista. */
  kind?: z.infer<typeof categoriaDispositivo>;
  lastSeen?: z.infer<typeof antiguedadDispositivo>;
};

/**
 * Proyección con lista blanca, igual que {@link enmascararDispositivo} y por lo mismo: se
 * construye un objeto nuevo, así que un campo nuevo en te-api —un nombre, un modelo, una marca de
 * tiempo— no llega a la pantalla de acceso aunque el servidor lo mande.
 *
 * El número se recorta a `[1, topeDispositivos]` y se redondea: una etiqueta fuera de rango sólo
 * puede venir de un servidor roto o manipulado, y pintar «a tus 900 dispositivos» sería creerle.
 *
 * `kind` y `lastSeen` **sólo se copian cuando el destino fue uno**. Con abanico, te-api ya no los
 * manda; esta comprobación es la segunda cerradura, para que un servidor que empezara a mandarlos
 * no convirtiera la pantalla en «tienes 3 dispositivos, y el más reciente es una tableta».
 */
export const enmascararDespacho = (bruto: {
  count: number;
  kind?: string;
  lastSeen?: string;
}): DespachoPush => {
  const crudo = Number.isFinite(bruto.count) ? Math.trunc(bruto.count) : 1;
  const count = Math.min(Math.max(crudo, 1), topeDispositivos);

  if (count > 1) {
    return { count };
  }

  const kind = categoriaDispositivo.safeParse(bruto.kind);
  const lastSeen = antiguedadDispositivo.safeParse(bruto.lastSeen);

  return {
    count,
    kind: kind.success ? kind.data : 'phone',
    lastSeen: lastSeen.success ? lastSeen.data : 'older',
  };
};

/**
 * El sondeo del push: lo mismo, **más la etiqueta de destino**.
 *
 * Guard aparte y no un campo opcional del de arriba a propósito. El canal QR no tiene destino que
 * nombrar —el código lo escanea quien lo tenga delante—, así que un campo compartido que sólo
 * rellena uno de los dos es una invitación a que el otro empiece a rellenarlo sin que nadie se
 * pregunte qué significaría.
 */
export const sondeoPushTeApiGuard = sondeoTeApiGuard.extend({
  dispatch: despachoTeApiGuard.nullish(),
});

export const retoPushGuard = z.object({
  challengeId: z.string(),
  expiresAt: z.string(),
  /** Los dos dígitos que la persona teclea en la cartera (PU-1). */
  matchDigits: z.string(),
});

type RetoPush = z.infer<typeof retoPushGuard>;

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
  /**
   * A dónde fue el aviso, para que la pantalla de espera del push deje de decir «a tu dispositivo»
   * sin decir a cuál. Ausente en el canal QR y ausente mientras no se haya despachado.
   *
   * Lo que sale de aquí es lo mismo que sale de la lista de dispositivos —categoría gruesa y
   * cubeta temporal— y sólo cuando el destino fue uno. El nombre que la persona le puso a su
   * teléfono no cabe en este tipo, y ésa es la garantía: no es que hoy no se mande, es que no
   * tiene por dónde salir.
   */
  dispatch: z
    .object({
      count: z.number(),
      kind: categoriaDispositivo.optional(),
      lastSeen: antiguedadDispositivo.optional(),
    })
    .optional(),
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
