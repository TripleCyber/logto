import { sha256, toBase64url, toBytes } from './encoding';

/**
 * Ligadura de canal, la misma idea que PKCE: esta pestaña guarda un secreto y publica sólo su
 * huella.
 *
 * El identificador de la sesión viaja dentro del QR y pasa por la cartera, así que por sí solo
 * no puede bastar para reclamar el login. Presentar el verifier es lo que prueba «soy la pestaña
 * que abrió esto». El verifier **no se guarda en `sessionStorage` ni en `localStorage`**: vive en
 * memoria de la pestaña y muere con ella. Persistirlo convertiría un XSS de lectura en una toma
 * de sesión reutilizable.
 *
 * Va siempre en la cabecera `X-Channel-Verifier`, nunca en el query ni en el path (ST-1): el
 * registro de acceso de Logto y su APM son igual de reales aunque el salto sea a nuestro propio
 * servidor.
 */
export type LigaduraCanal = {
  /** Secreto de 32 bytes en base64url. Sólo sale de aquí por la cabecera del canal. */
  readonly verifier: string;
  /** `base64url(sha256(verifier))`. Es lo único que se declara al abrir el canal. */
  readonly channelHash: string;
  /** Los bytes crudos de la huella: los necesita la derivación del número de emparejamiento. */
  readonly channelHashBytes: Uint8Array;
};

export const crearLigadura = async (): Promise<LigaduraCanal> => {
  const verifier = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const channelHashBytes = await sha256(toBytes(verifier));

  return { verifier, channelHash: toBase64url(channelHashBytes), channelHashBytes };
};
