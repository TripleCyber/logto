import api from '@/apis/api';
import { experienceApiRoutes } from '@/apis/experience/const';

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

export type Sondeo = {
  readonly frame: MarcoCanal;
  /** Ritmo dictado por el servidor. **0 significa PARAR**, no sondear sin pausa. */
  readonly retryAfterMs: number;
  /** Cabecera `Date` de la respuesta, para corregir el reloj de la pantalla (OP-2). */
  readonly cabeceraDate: string | undefined;
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

/** Abre el canal QR declarando la huella del verifier. */
export const abrirCanalQr = async (channelHash: string): Promise<AperturaCanal> =>
  api.post(prefijo, { json: { channel: 'qr', channelHash } }).json<AperturaCanal>();

/**
 * Abre el canal push.
 *
 * El identificador va **en el cuerpo**, nunca en el query: te-api sólo guarda su huella
 * (`login_hint_fp`) y Logto no lo registra en el log de auditoría. Abrir el canal no despacha
 * nada todavía; el despacho es `despacharPush`.
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

  const cuerpo = await respuesta.json<{ frame: MarcoCanal; retryAfterMs: number }>();

  // `Headers.get` devuelve `null` cuando la cabecera falta; se normaliza aquí para que el resto
  // del canal maneje una sola forma de «no hay dato».
  return { ...cuerpo, cabeceraDate: respuesta.headers.get('Date') ?? undefined };
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
