/**
 * El reloj de la pantalla — **el del servidor, no el del portátil** (OP-2).
 *
 * Portado de `tripleenable-api/src/navegador/reloj.js`. Nada de esto nace en el navegador: la
 * cuenta atrás sale de `displayExpiresAt`, una fecha que escribió el motor de la base al acuñar
 * la fila. Lo único que este módulo aporta es la corrección del desfase entre los dos relojes,
 * que se mide **una vez** con la cabecera `Date` de la primera respuesta.
 *
 * Sin esa corrección, un portátil cuarenta segundos adelantado pinta «caducado» sobre un código
 * perfectamente vivo, y la persona vuelve a empezar una y otra vez sin que haya nada roto. Es el
 * fallo que más se parece a un problema de red y menos lo es.
 *
 * El desfase se mide una sola vez y no se refresca: una suspensión larga lo desajusta, y eso se
 * arregla solo porque el siguiente sondeo trae fechas frescas (CH-6). Un reajuste continuo daría
 * al servidor un mando sobre el reloj de la pantalla en cada respuesta: más superficie a cambio
 * de nada.
 */

/**
 * Desfase en milisegundos entre el reloj del servidor y el de esta máquina.
 *
 * Devuelve 0 —«no corrijas nada»— si la cabecera falta o no se puede leer. Un desfase inventado
 * sería peor que ninguno: la resolución de `Date` es de un segundo, así que el valor ya trae
 * hasta un segundo de error, y por eso la pantalla nunca promete más precisión que ésa.
 */
export const desfase = (cabeceraDate: string | undefined, ahoraLocal: number): number => {
  if (!cabeceraDate) {
    return 0;
  }

  const servidor = Date.parse(cabeceraDate);

  return Number.isNaN(servidor) ? 0 : servidor - ahoraLocal;
};

/** Un reloj corregido. `ahora()` devuelve milisegundos en la escala del servidor. */
export const crearReloj = (correccion: number) => ({ ahora: () => Date.now() + correccion });

/** Milisegundos que quedan hasta un instante ISO. Nunca negativo. */
export const restanteMs = (instanteIso: string, ahoraMs: number): number => {
  const fin = Date.parse(instanteIso);

  if (Number.isNaN(fin)) {
    return 0;
  }

  const restante = fin - ahoraMs;

  return restante > 0 ? restante : 0;
};

/**
 * Segundos que quedan, redondeados **hacia arriba**.
 *
 * Hacia arriba y no hacia abajo para que la pantalla no diga nunca «0 s» mientras el código
 * todavía sirve: es preferible que el número vaya un instante por detrás de la verdad a que
 * anuncie una caducidad que no ha ocurrido.
 */
export const segundos = (milisegundos: number): number => Math.ceil(milisegundos / 1000);

/**
 * La fracción de barra que queda, entre 0 y 1.
 *
 * La escala es **lo que quedaba la primera vez que se vio este código**, no una constante del
 * cliente. Es la única forma honesta de dibujar una barra cuando el servidor manda el instante
 * de caducidad pero no el de emisión: así la barra sólo puede encogerse y nunca promete más
 * tiempo del que el servidor dijo.
 */
export const fraccion = (restante: number, escala: number): number => {
  if (escala <= 0) {
    return 0;
  }

  const valor = restante / escala;

  if (valor <= 0) {
    return 0;
  }

  return valor >= 1 ? 1 : valor;
};
