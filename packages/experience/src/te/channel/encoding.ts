/**
 * Base64url y SHA-256 en el navegador.
 *
 * Portado de `tripleenable-api/src/navegador/codificacion.js`. No es una copia por comodidad:
 * son las dos primitivas con las que se construye la ligadura de canal, y el servidor de Logto
 * hace exactamente lo mismo del otro lado (`packages/core/src/te/route-helpers.ts` calcula
 * `createHash('sha256').update(verifier, 'utf8').digest('base64url')`). Un `base64url` que
 * difiera en el relleno, o un `sha256` que hashee la cadena en vez de sus bytes, convierte la
 * comprobación del verifier en un fallo intermitente cuyo único síntoma es un error uniforme
 * del canal — y el error es uniforme a propósito, así que no dirá cuál de las dos falló.
 *
 * El silencio de reglas de abajo es de este archivo y de ninguno más: es aritmética de bits sobre
 * un búfer, y escribirla en el estilo del resto del paquete la haría imposible de comparar línea
 * a línea con el original del servidor, que es de donde tiene que salir byte por byte.
 */
/* eslint-disable no-bitwise, @silverhand/fp/no-let, @silverhand/fp/no-mutation */

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Bytes → base64url **sin relleno**.
 *
 * Escrito a mano en vez de con `btoa`: `btoa` trabaja sobre una cadena binaria, obliga a
 * `String.fromCharCode(...bytes)` —que revienta la pila con entradas grandes— y produce el
 * alfabeto estándar, que luego hay que traducir. Traducir después es donde alguien acaba
 * dejando el `=` y el servidor rechaza una cerradura perfectamente buena.
 */
export const toBase64url = (bytes: Uint8Array): string => {
  // `reduce` sobre cadenas es cuadrática en entradas grandes.
  let salida = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index] ?? 0;
    const b1 = bytes[index + 1] ?? 0;
    const b2 = bytes[index + 2] ?? 0;
    const restantes = bytes.length - index;

    salida += ALFABETO[b0 >> 2];
    salida += ALFABETO[((b0 & 0x03) << 4) | (b1 >> 4)];

    if (restantes > 1) {
      salida += ALFABETO[((b1 & 0x0f) << 2) | (b2 >> 6)];
    }

    if (restantes > 2) {
      salida += ALFABETO[b2 & 0x3f];
    }
  }

  return salida;
};

/** Cadena → bytes UTF-8. Escrito una vez aquí para que ningún punto de llamada lo improvise. */
export const toBytes = (texto: string): Uint8Array => new TextEncoder().encode(texto);

/**
 * SHA-256 de unos bytes, con `crypto.subtle`: la única implementación que el navegador ofrece
 * y la única que no hay que auditar.
 */
export const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> => {
  // `new Uint8Array(bytes)` copia: `digest` quiere un `ArrayBuffer`, y pasarle el buffer de una
  // vista con desplazamiento hashearía el buffer entero.
  const copia = new Uint8Array(bytes);
  const resumen = await crypto.subtle.digest('SHA-256', copia.buffer);

  return new Uint8Array(resumen);
};

/* eslint-enable */
