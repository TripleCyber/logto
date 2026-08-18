/**
 * El ancla de la tarjeta a dos columnas.
 *
 * ## Por qué hace falta una clase global y no basta el CSS Module
 *
 * La columna del código se pinta **dentro** de la tarjeta (`.logto_main-content`, el `<main>` de
 * `AppLayout`), pero quien tiene que cambiar de tamaño es la tarjeta, que es un antepasado. Desde
 * un módulo CSS no se puede subir: un selector no remonta el árbol.
 *
 * La hoja `te/theme/signin-split.scss` lo resuelve con `:has()` — «la tarjeta que contiene esta
 * columna mide 860 px y deja sitio a la izquierda»— y para eso necesita un nombre de clase
 * **estable**, no uno hasheado por el build. De ahí esta constante: es el único punto de contacto
 * entre el componente y la hoja global, y vive en un módulo propio para que el nombre no se pueda
 * cambiar en un sitio y no en el otro.
 *
 * Es el mismo mecanismo que Logto ya usa para sus propios ganchos (`utils/consts.ts` →
 * `layoutClassNames`), así que no introduce una técnica nueva en la casa.
 *
 * ## Lo que esto compra: la columna no puede quedar vacía
 *
 * El ancho de la tarjeta cuelga de la **presencia del nodo**, no de una bandera aparte. Si el
 * conector está apagado el componente no se monta, `:has()` no casa y la tarjeta vuelve a sus 540
 * px de siempre. No hay ningún estado en el que la tarjeta reserve un hueco que nadie llena.
 */

/** Clase global que marca la columna del código dentro de la tarjeta de acceso. */
export const claseAncla = 'te_signin-aside';
