import type { MiddlewareType } from 'koa';
import { type IRouterParamContext } from 'koa-router';

import type TenantContext from '#src/tenants/TenantContext.js';

import ExperienceInteraction from '../classes/experience-interaction.js';
import { experienceRoutes } from '../const.js';
import { type WithHooksAndLogsContext } from '../types.js';

export type WithExperienceInteractionContext<
  ContextT extends IRouterParamContext = IRouterParamContext,
> = ContextT & {
  experienceInteraction: ExperienceInteraction;
};

/**
 * White-listed endpoints that does not require an validation and initialization of `ExperienceInteraction`.
 */
const whiteListedEndpoint = [
  // PUT /experience:  New ExperienceInteraction instance supposed to be created for this request.
  {
    method: 'PUT',
    path: `${experienceRoutes.prefix}`,
  },
  // GET /experience/sso-connectors:  Fetch available SSO connectors for a given email, no interaction needed.
  {
    method: 'GET',
    path: `${experienceRoutes.prefix}/sso-connectors`,
  },
  // POST /experience/preflight/sign-in-passkey/authentication:  Generate WebAuthn authentication options for passkey sign-in, no interaction needed.
  {
    method: 'POST',
    path: `${experienceRoutes.prefix}/preflight/sign-in-passkey/authentication`,
  },
  /**
   * LOGTO PATCH(te-channel-proxy): GET /experience/verification/te-channel/config
   *
   * Es la lectura del interruptor, y la pantalla de acceso la hace **al pintarse**, antes de que
   * exista ninguna interacción: es lo que decide si el QR se dibuja. Sin esta entrada respondía
   * `404 session.interaction_not_found` en cada carga, el cliente lo trataba como fail-closed y el
   * factor no se ofrecía nunca — el canal entero quedaba invisible sin que nada lo dijera.
   *
   * Que esté aquí NO relaja la regla del resto del canal. Las otras seis rutas —abrir, rotar,
   * sondear, confirmar, despachar y listar dispositivos— siguen exigiendo una interacción viva, que
   * es la precondición que impide que una sesión de canal exista fuera de un login en curso (DS-2).
   * Ésta no toca estado de interacción, no crea nada y no lee nada del usuario: devuelve dos
   * booleanos de configuración del tenant, exactamente como `GET /experience/sso-connectors`.
   *
   * Upstream: la lista tenía tres entradas.
   */
  {
    method: 'GET',
    path: `${experienceRoutes.verification}/te-channel/config`,
  },
];

/**
 * @overview This middleware initializes the `ExperienceInteraction` for the current request.
 * The `ExperienceInteraction` instance is used to manage all the data related to the current interaction.
 * All the interaction data is stored using oidc-provider's interaction session.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#user-flows}
 */
export default function koaExperienceInteraction<
  StateT,
  ContextT extends WithHooksAndLogsContext,
  ResponseT,
>(
  tenant: TenantContext
): MiddlewareType<StateT, WithExperienceInteractionContext<ContextT>, ResponseT> {
  return async (ctx, next) => {
    const {
      interactionDetails,
      request: { method, path },
    } = ctx;

    // Skip initializing `ExperienceInteraction` for white-listed endpoints.
    if (
      whiteListedEndpoint.some((endpoint) => endpoint.method === method && endpoint.path === path)
    ) {
      return next();
    }

    ctx.experienceInteraction = new ExperienceInteraction(ctx, tenant, interactionDetails);

    try {
      await next();
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- make sure the interaction is initialized
      if (ctx.experienceInteraction) {
        ctx.prependAllLogEntries({
          interaction: ctx.experienceInteraction.toJson(),
          userId: ctx.experienceInteraction.identifiedUserId,
        });
      }

      throw error;
    }
  };
}
