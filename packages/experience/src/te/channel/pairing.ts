import { sha256, toBytes } from './encoding';

/* Aritmética de bits portada del original del servidor: tiene que dar el mismo número. */
/* eslint-disable no-bitwise */

/**
 * El número de emparejamiento, calculado **en el navegador** (RL-1).
 *
 * `pairCode = uint32_be(sha256("te-pair/2" ‖ sessionId ‖ sha256(verifier))[0..4]) mod 10000`
 *
 * Portado de `tripleenable-api/src/navegador/emparejamiento.js`, y portarlo era obligatorio: lo
 * que hace que este número signifique algo es precisamente que **no lo diga el servidor**. El
 * material del que sale —el verifier— nunca salió de esta pestaña, así que un servidor
 * comprometido no puede inventar un número que haga coincidir las dos pantallas. La cartera
 * enseña el suyo, derivado del mismo material por el lado del servidor; si no coinciden, la
 * persona está mirando una pantalla y aprobando otra.
 *
 * Se deriva del identificador de la sesión y no del código escaneado porque el código rota cada
 * 30 s: un escaneo que caiga en la gracia del código N mientras la pantalla ya pinta el N+1
 * daría dos números distintos para un flujo perfectamente legítimo. Un falso positivo aquí le
 * dice al usuario legítimo que pare, y eso entrena a ignorar la comprobación.
 *
 * Lo que este número **no** hace, escrito al lado del que lo calcula: no detiene el relay de
 * espejo. Quien monte el cebo obtiene el suyo y lo pinta. Sólo detecta que la cartera está
 * resolviendo una sesión distinta de la pantalla que la persona mira. Necesario y no suficiente.
 */
const DOMINIO_PAIR = 'te-pair/2';

export const numeroDeEmparejamiento = async (
  sessionId: string,
  channelHashBytes: Uint8Array
): Promise<number> => {
  const dominio = toBytes(DOMINIO_PAIR);
  const identificador = toBytes(sessionId);
  const material = new Uint8Array(dominio.length + identificador.length + channelHashBytes.length);

  material.set(dominio, 0);
  material.set(identificador, dominio.length);
  material.set(channelHashBytes, dominio.length + identificador.length);

  const resumen = await sha256(material);
  const primeros =
    ((resumen[0] ?? 0) * 0x1_00_00_00 +
      (resumen[1] ?? 0) * 0x1_00_00 +
      (resumen[2] ?? 0) * 0x1_00 +
      (resumen[3] ?? 0)) >>>
    0;

  return primeros % 10_000;
};

/**
 * El número tal y como se lee en voz alta: cuatro cifras con ceros a la izquierda.
 *
 * Sin el relleno, `42` y `0042` son el mismo número y dos pantallas distintas; y la comparación
 * que se le pide a una persona tiene que ser de caracteres, no de aritmética.
 */
export const comoTexto = (numero: number): string => String(numero).padStart(4, '0');

/* eslint-enable */
