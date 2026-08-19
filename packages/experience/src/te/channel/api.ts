import { InteractionEvent } from '@logto/schemas';

import api from '@/apis/api';
import { experienceApiRoutes } from '@/apis/experience/const';
import { initInteraction } from '@/apis/experience/interaction';

import { type CodigoCanal, type MarcoCanal } from './machine';

/**
 * Cliente del canal TripleEnable.
 *
 * **Todo esto va contra el propio origen de Logto.** El navegador no emite ni una petición hacia
 * te-api: ni `fetch`, ni `WebSocket`, ni `<img>`, ni navegación. Logto expone las rutas del canal
 * en su origen y las proxea servidor a servidor. Añadir el origen de te-api a `connect-src` de la
 * CSP para llamarlo desde aquí es un error, no una comodidad: devolvería las cookies del canal a
 * la categoría de terceros —que Safari bloquea de fábrica— y volvería a poner te-api al alcance
 * de cualquier navegador.
 *
 * Por eso se reutiliza la instancia de `@/apis/api`: es la que lleva `Accept-Language` y
 * `Logto-App-Id`, que es lo que hace que el servidor encuentre la interacción OIDC de esta
 * pestaña. Un `fetch` a pelo, como hacía la rama previa, se queda sin las dos cosas.
 */

const prefijo = `${experienceApiRoutes.verification}/te-channel`;

/**
 * El verifier viaja por cabecera, **jamás en el query ni en el path** (ST-1). El registro de
 * acceso de Logto, su APM y cualquier proxy que termine TLS son igual de reales aunque el salto
 * sea a nuestro propio servidor.
 */
const cabeceraVerifier = 'X-Channel-Verifier';

export type ConfigCanal = {
  readonly channels: { readonly qr: boolean; readonly push: boolean };
  readonly devicePicker: 'lazy' | 'eager';
};

export type AperturaCanal = {
  readonly verificationId: string;
  readonly sessionId?: string;
  readonly expiresAt?: string;
  readonly code?: CodigoCanal;
};

export type RetoPush = {
  readonly challengeId: string;
  readonly expiresAt: string;
  /** Los dos dígitos que se leen en pantalla y se teclean en la cartera (PU-1). */
  readonly matchDigits: string;
};

export type DispositivoEnmascarado = {
  /** Opaco y ligado a este reto. No sirve para correlacionar entre sesiones. */
  readonly deviceRef: string;
  readonly kind: 'phone' | 'tablet' | 'desktop';
  readonly lastSeen: 'today' | 'this_week' | 'older';
};

/**
 * A dónde fue el aviso del push, enmascarado.
 *
 * Es lo que la pantalla de espera necesita para dejar de decir «a tu dispositivo» sin decir a
 * cuál. Llega por el **sondeo** y no al despachar, y la razón es del servidor: cuando
 * `despacharPush` responde todavía no se ha despachado nada — te-api resuelve el identificador en
 * un trabajador de fondo, fuera del ciclo de petición, justo para que la latencia de esa respuesta
 * no diga si la cuenta existe (PU-4).
 *
 * Y llega igual cuando el reto es un **señuelo**: te-api fabrica una etiqueta con un HMAC del
 * identificador para que esta línea no pueda delatar si la cuenta existe. Esta pantalla no
 * distingue los dos casos y **no puede**: recibe una etiqueta y la pinta.
 */
export type DespachoPush = {
  /** Cuántos destinos recibieron el aviso. */
  readonly count: number;
  /** Sólo cuando el destino fue uno. Con abanico no viene: sería entregar la lista (PU-12). */
  readonly kind?: 'phone' | 'tablet' | 'desktop';
  readonly lastSeen?: 'today' | 'this_week' | 'older';
};

export type Sondeo = {
  readonly frame: MarcoCanal;
  /** Ritmo dictado por el servidor. **0 significa PARAR**, no sondear sin pausa. */
  readonly retryAfterMs: number;
  /** Cabecera `Date` de la respuesta, para corregir el reloj de la pantalla (OP-2). */
  readonly cabeceraDate: string | undefined;
  /** Ver {@link DespachoPush}. Ausente en el QR y mientras no se haya despachado. */
  readonly despacho?: DespachoPush;
};

/**
 * Interruptores del canal.
 *
 * Fail-closed por diseño en el servidor: si te-api no contesta, esto responde todo apagado y la
 * experiencia sencillamente no ofrece el factor. Un botón que existe y falla es peor que un botón
 * que no está — el primero convierte una caída en un fallo de acceso que la persona se atribuye.
 */
export const leerConfigCanal = async (): Promise<ConfigCanal> =>
  api.get(`${prefijo}/config`).json<ConfigCanal>();

/**
 * Arranca la interacción de acceso antes de abrir el canal.
 *
 * Sin esto no hay canal posible: las rutas del canal exigen una interacción de la experiencia viva
 * —es la precondición que impide que una sesión exista fuera de un login en curso (DS-2)— y en la
 * pantalla de acceso recién cargada todavía no hay ninguna. El servidor respondía
 * `404 session.interaction_not_found` y la pantalla se quedaba en «no se pudo abrir» sin decir por
 * qué. Es exactamente lo que hace `getSocialAuthorizationUrl` antes de pedir la URL del conector
 * (`@/apis/experience/social.ts`), y por el mismo motivo.
 *
 * Siempre `SignIn`, nunca `Register`: en el alta no se ofrece TripleEnable (C4), y la ruta del
 * canal rechaza además una interacción de alta por su cuenta.
 */
const arrancarAcceso = async () => initInteraction(InteractionEvent.SignIn);

/** Abre el canal QR declarando la huella del verifier. */
export const abrirCanalQr = async (channelHash: string): Promise<AperturaCanal> => {
  await arrancarAcceso();

  return api.post(prefijo, { json: { channel: 'qr', channelHash } }).json<AperturaCanal>();
};

/**
 * Abre el canal push.
 *
 * El identificador va **en el cuerpo**, nunca en el query: te-api sólo guarda su huella
 * (`login_hint_fp`) y Logto no lo registra en el log de auditoría. Abrir el canal no despacha
 * nada todavía; el despacho es `despacharPush`.
 *
 * ## Por qué aquí NO se arranca la interacción, y en el QR sí
 *
 * Porque arrancarla es **crear una nueva**, y eso descarta la que ya hay. El QR se abre desde la
 * pantalla de acceso recién cargada, donde no existe ninguna, así que crearla es justo lo que hace
 * falta. El push se abre desde la pantalla de segundo factor, donde ya existe una **con la
 * contraseña verificada y el titular identificado dentro** — y es de ahí de donde sale el
 * `identifiedUserId` que el despacho manda a te-api para saber a quién avisar.
 *
 * Llamar a `initInteraction` aquí tiraba las dos cosas. El reto nacía sin destino, te-api lo
 * marcaba señuelo y el teléfono no sonaba jamás; el registro de auditoría lo enseñaba como un
 * segundo «Create new sign-in interaction» justo antes de abrir el canal, con el usuario en `-`
 * después de haberlo identificado tres segundos antes. Y por diseño (PU-4) el síntoma es
 * indistinguible de un rechazo: dos minutos de espera y el mensaje uniforme.
 */
export const abrirCanalPush = async (loginHint: string): Promise<AperturaCanal> =>
  api.post(prefijo, { json: { channel: 'push', loginHint } }).json<AperturaCanal>();

/** Rota el código del QR. */
export const rotarCodigo = async (verifier: string): Promise<CodigoCanal> =>
  api.post(`${prefijo}/code`, { headers: { [cabeceraVerifier]: verifier } }).json<CodigoCanal>();

/** Un sondeo. Devuelve el marco, el ritmo con el que hay que volver y la hora del servidor. */
export const sondear = async (verifier?: string): Promise<Sondeo> => {
  const respuesta = await api.post(`${prefijo}/poll`, {
    headers: verifier ? { [cabeceraVerifier]: verifier } : undefined,
  });

  const cuerpo = await respuesta.json<{
    frame: MarcoCanal;
    retryAfterMs: number;
    dispatch?: DespachoPush;
  }>();

  // `Headers.get` devuelve `null` cuando la cabecera falta; se normaliza aquí para que el resto
  // del canal maneje una sola forma de «no hay dato». El nombre del campo se castellaniza aquí, en
  // el borde, que es donde el resto del canal deja de hablar el idioma del servidor.
  return {
    frame: cuerpo.frame,
    retryAfterMs: cuerpo.retryAfterMs,
    cabeceraDate: respuesta.headers.get('Date') ?? undefined,
    ...(cuerpo.dispatch ? { despacho: cuerpo.dispatch } : {}),
  };
};

/**
 * Confirma y redime.
 *
 * El `code` OAuth2 muere en el servidor de Logto: lo único que vuelve es `{ verificationId }`.
 * A partir de ahí el navegador sigue el camino nativo —identificación y `submit`— con lo que MFA,
 * perfil obligatorio y alta de passkey siguen aplicando igual que tras una contraseña.
 */
export const confirmarCanal = async (verifier?: string): Promise<{ verificationId: string }> =>
  api
    .post(`${prefijo}/confirm`, {
      headers: verifier ? { [cabeceraVerifier]: verifier } : undefined,
    })
    .json<{ verificationId: string }>();

/**
 * C3, pasos 1 y 3: despacha el push.
 *
 * Sin `deviceRef`, el servidor elige el dispositivo elegible más reciente y **no enseña nada**.
 * La respuesta es idéntica cuando el identificador no resuelve a ningún usuario, así que esperar
 * y fallar es indistinguible de esperar y que la persona no apruebe.
 */
export const despacharPush = async (deviceRef?: string): Promise<RetoPush> =>
  api.post(`${prefijo}/push`, { json: deviceRef ? { deviceRef } : {} }).json<RetoPush>();

/**
 * C3, paso 2: la lista enmascarada.
 *
 * Sólo responde tras un reto fallido o caducado (o con el opt-in `eager` del tenant). Antes de
 * eso devuelve el mismo error uniforme que cualquier otro fallo del canal, así que preguntar no
 * distingue «todavía no» de «esta cuenta no existe».
 */
export const listarDispositivos = async (): Promise<{
  devices: readonly DispositivoEnmascarado[];
}> => api.post(`${prefijo}/push/devices`).json<{ devices: DispositivoEnmascarado[] }>();
