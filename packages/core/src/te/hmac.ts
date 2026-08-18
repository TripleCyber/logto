import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { type ClaveHmacTe } from './config.js';

/**
 * Sobre de autenticación servidor-a-servidor Logto → te-api.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CORS NO ES LA DEFENSA. Lo impone el navegador; `curl` ignora `Origin` en una
 * línea. CORS evita que otra web llame desde el navegador de la víctima; no
 * evita que alguien llame. La defensa de que sólo Logto pueda hablar con te-api
 * es exactamente este HMAC, más te-api escuchando en red privada. Que nadie
 * construya ninguna decisión de permisos encima de una cabecera `Origin`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Por qué HMAC y no un secreto compartido en `Authorization: Bearer`: el bearer viaja íntegro en
 * cada petición, así que aparece en el primer volcado de cabeceras que alguien active para
 * depurar, en el APM y en el proxy que termina TLS; y una vez filtrado es reproducible para
 * siempre y para cualquier cuerpo. Con HMAC el secreto nunca sale del proceso: lo que viaja es una
 * firma, que sirve para una petición, un cuerpo y sesenta segundos.
 *
 * Por qué no mTLS: te-api corre detrás de un proxy inverso que termina TLS, así que el certificado
 * de cliente llegaría como una cabecera que el proxy inyecta — «confío en una cabecera», que es
 * peor que esto y más difícil de auditar. Si algún día te-api termina su propio TLS, mTLS es un
 * complemento del HMAC, nunca un sustituto.
 */

/** Versión del formato canónico. Va dentro de la firma para poder cambiarlo sin ambigüedad. */
const version = 'TE1';

const base64url = (dato: Uint8Array): string => Buffer.from(dato).toString('base64url');

/**
 * Cadena canónica que se firma.
 *
 * `PATH` incluye el query string (aquí siempre vacío, pero firmar sólo el cuerpo dejaría la ruta
 * maleable: un atacante con una firma capturada podría reapuntarla a otro endpoint). El cuerpo
 * vacío firma `sha256("")`; el campo nunca se omite, porque omitirlo hace que dos peticiones
 * distintas colisionen en la misma cadena.
 */
export const cadenaCanonica = ({
  metodo,
  ruta,
  marcaTiempo,
  nonce,
  cuerpo,
}: {
  metodo: string;
  ruta: string;
  marcaTiempo: number;
  nonce: string;
  cuerpo: string;
}): string =>
  [
    version,
    metodo.toUpperCase(),
    ruta,
    String(marcaTiempo),
    nonce,
    base64url(createHash('sha256').update(cuerpo, 'utf8').digest()),
  ].join('\n');

export const firmar = (secreto: Uint8Array, canonica: string): string =>
  base64url(createHmac('sha256', secreto).update(canonica, 'utf8').digest());

/**
 * Comparación en tiempo constante. No se usa en el camino de Logto (Logto firma, no verifica),
 * pero se exporta porque el receptor del webhook de te-api usa exactamente la misma primitiva y
 * tener una sola implementación evita que una de las dos se escriba con `===`.
 */
export const igualesEnTiempoConstante = (uno: string, otro: string): boolean => {
  const bufferA = Buffer.from(uno, 'utf8');
  const bufferB = Buffer.from(otro, 'utf8');

  // `timingSafeEqual` exige la misma longitud; comparar longitudes antes filtra sólo el tamaño,
  // que no es secreto.
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
};

export const cabeceraKeyId = 'x-te-key-id';
export const cabeceraMarcaTiempo = 'x-te-timestamp';
export const cabeceraNonce = 'x-te-nonce';
export const cabeceraFirma = 'x-te-signature';

/**
 * Cabeceras del sobre firmado.
 *
 * El nonce es de un solo uso y te-api lo recuerda con TTL de 120 s: sin él, una petición capturada
 * se puede repetir dentro de la ventana de ±60 s, y «una vez es una vez» es justo lo que hace que
 * confirmar un login no sea repetible.
 */
export const construirCabecerasFirma = ({
  clave,
  metodo,
  ruta,
  cuerpo,
  ahora = Date.now(),
  nonce = base64url(randomBytes(16)),
}: {
  clave: ClaveHmacTe;
  metodo: string;
  ruta: string;
  cuerpo: string;
  ahora?: number;
  nonce?: string;
}): Record<string, string> => {
  const canonica = cadenaCanonica({ metodo, ruta, marcaTiempo: ahora, nonce, cuerpo });

  return {
    [cabeceraKeyId]: clave.kid,
    [cabeceraMarcaTiempo]: String(ahora),
    [cabeceraNonce]: nonce,
    [cabeceraFirma]: firmar(clave.secreto, canonica),
  };
};
