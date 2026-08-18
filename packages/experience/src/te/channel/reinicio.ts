/**
 * Empezar el acceso de nuevo cuando la interacción de Logto ya no existe.
 *
 * Es una recarga, y no una petición, porque no hay petición que sirva: `PUT /api/experience` —lo
 * único que crea una interacción desde el navegador— vive detrás de `koaInteractionDetails`, o sea
 * que necesita la interacción que precisamente ya no está. La interacción sólo nace de una
 * navegación a `/oidc/auth`, y esta pantalla no tiene sus parámetros.
 *
 * Lo que sí sabe hacer el servidor es recibir esta recarga: `koa-spa-session-guard.ts` ve que no
 * hay interacción y manda a `/unknown-session`, o a donde el tenant haya configurado. Así que
 * recargar es exactamente «devuélveme a donde se empieza», dicho en el único idioma que entiende
 * esta capa.
 *
 * Vive en su propio módulo por una razón práctica: `location.reload` no está implementado en jsdom
 * y no se puede espiar sin reemplazar el objeto entero. Con una función aparte, el test comprueba
 * que la pantalla la llama, que es lo que importa.
 */
export const reiniciarAcceso = (): void => {
  window.location.reload();
};
