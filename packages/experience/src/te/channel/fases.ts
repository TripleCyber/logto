import { trySafe } from '@silverhand/essentials';
import { HTTPError } from 'ky';

/**
 * Qué le puede pasar a la pantalla del canal, y cómo se reparte un fallo entre esas cosas.
 *
 * Vive fuera del hook porque no es del hook: `TeStatus` y `superficie.ts` preguntan por la fase sin
 * tener ningún canal abierto, y tenerla colgando de `use-te-channel` obligaba a importar un motor
 * entero para leer un tipo.
 */

/** Lo que la pantalla necesita saber para dibujarse. */
export type FaseCanal =
  | 'inactivo'
  | 'abriendo'
  | 'esperando'
  | 'escaneado'
  | 'confirmando'
  | 'aprobado'
  | 'rechazado'
  | 'caducado'
  | 'fallo'
  | 'sinRed'
  /**
   * El login entero se ha ido, no sólo el canal.
   *
   * Es la fase que faltaba y la que explica el fallo que se veía como «"Reintentar" no hace nada».
   * La interacción OIDC de Logto caduca a la hora (`core/src/oidc/init.ts`, `Interaction: 3600`) y,
   * a partir de ahí, **todas** las rutas de la experiencia responden `404 session.not_found` —
   * también `PUT /api/experience`, que es lo primero que hace la reapertura del canal. El resultado
   * medido: pulsar «Reintentar» disparaba una petición, recibía el 404, lo metía en el mismo saco
   * que cualquier otro 4xx y repintaba **exactamente la misma pantalla**. Nada cambiaba, así que
   * parecía que el botón estaba muerto.
   *
   * Y aquí no hay nada que reintentar: la interacción sólo la puede crear una navegación a
   * `/oidc/auth` desde la aplicación, y esta pantalla no tiene sus parámetros. `PUT /api/experience`
   * tampoco sirve — vive detrás de `koaInteractionDetails`, o sea que también necesita la
   * interacción que ya no existe. Lo único honesto es decirlo y ofrecer empezar de nuevo, que es
   * recargar: el servidor manda entonces a `/unknown-session` o a donde el tenant haya dicho
   * (`koa-spa-session-guard.ts`).
   */
  | 'sesionCaducada';

/** Las tres formas de que algo salga mal, que son tres situaciones distintas y no una. */
export type ClaseDeFallo = 'sesionCaducada' | 'fallo' | 'sinRed';

/**
 * Los códigos con los que Logto dice que la interacción de login ya no existe.
 *
 * `session.not_found` lo pone `koaOidcErrorHandler` cuando `provider.interactionDetails` no
 * encuentra la sesión; `session.interaction_not_found` lo lanza `ExperienceInteraction` cuando la
 * hay pero está vacía. Para quien mira la pantalla son la misma cosa: hay que empezar de nuevo.
 */
const codigosSesionPerdida: ReadonlySet<string> = new Set([
  'session.not_found',
  'session.interaction_not_found',
]);

/**
 * Reparte un fallo entre las tres cosas distintas que puede ser.
 *
 * Antes eran dos —`HTTPError` o no— y por eso el 404 de una interacción muerta se contaba como «el
 * canal no sirve, pide otro código». Es el mismo tipo de error y una situación distinta: del canal
 * se vuelve pidiendo otro código, y del login caducado no se vuelve sin rehacer el login.
 */
export const clasificarFallo = async (error: unknown): Promise<ClaseDeFallo> => {
  // Un fallo sin respuesta HTTP es la red, y de eso sí se vuelve solo.
  if (!(error instanceof HTTPError)) {
    return 'sinRed';
  }

  /*
   * `clone()` para no gastar el cuerpo: quien haya recibido este error puede querer leerlo también.
   * Y todo entre `trySafe` porque aquí llega lo que trajo la red: una respuesta sin cuerpo, con un
   * JSON roto o sin `response` siquiera —lo que fabrica un doble de test— no puede tumbar la
   * pantalla. Sin código legible se asume lo de siempre: el canal, que es lo recuperable.
   */
  const codigo = await trySafe(async () => {
    const cuerpo = await error.response.clone().json<{ code?: string }>();

    return cuerpo.code;
  });

  return codigo !== undefined && codigosSesionPerdida.has(codigo) ? 'sesionCaducada' : 'fallo';
};
