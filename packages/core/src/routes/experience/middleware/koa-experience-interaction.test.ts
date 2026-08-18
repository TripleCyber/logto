import { createContextWithRouteParameters } from '#src/utils/test-utils.js';

import { experienceRoutes } from '../const.js';

import koaExperienceInteraction from './koa-experience-interaction.js';

const { jest } = import.meta;

/**
 * LOGTO PATCH(te-channel-proxy): la lista blanca de este middleware.
 *
 * El caso que importa es el del interruptor del canal. La pantalla de acceso lo lee **al
 * pintarse**, antes de que exista ninguna interacción, porque es lo que decide si el código se
 * dibuja. Sin la entrada en la lista respondía `404 session.interaction_not_found` en cada carga,
 * el cliente lo trataba como fail-closed y el factor no se ofrecía nunca — el canal entero quedaba
 * invisible y nada lo decía.
 *
 * El segundo caso es el que impide que la excusa se extienda: abrir el canal **sigue** exigiendo
 * una interacción viva, que es la precondición que impide que una sesión de canal exista fuera de
 * un login en curso (DS-2).
 */
const contexto = (method: string, path: string) => ({
  ...createContextWithRouteParameters(),
  request: { method, path },
  // Una interacción OIDC recién creada: existe la sesión, pero no hay estado de experiencia.
  interactionDetails: { result: {} },
  prependAllLogEntries: jest.fn(),
});

describe('la lista blanca de la interacción', () => {
  // @ts-expect-error -- el middleware sólo usa `interactionDetails` y el `tenant` para construir.
  const middleware = koaExperienceInteraction({});

  it('deja pasar la lectura del interruptor del canal sin interacción', async () => {
    const ctx = contexto('GET', `${experienceRoutes.verification}/te-channel/config`);
    const next = jest.fn();

    // @ts-expect-error -- contexto mínimo a propósito.
    await middleware(ctx, next);

    expect(next).toHaveBeenCalled();
    // Ni siquiera se construye: no hay nada que leer de una interacción que no existe.
    expect('experienceInteraction' in ctx).toBe(false);
  });

  it('pero abrir el canal sigue exigiéndola (DS-2)', async () => {
    const ctx = contexto('POST', `${experienceRoutes.verification}/te-channel`);

    await expect(
      // @ts-expect-error -- contexto mínimo a propósito.
      middleware(ctx, jest.fn())
    ).rejects.toMatchObject({ code: 'session.interaction_not_found' });
  });
});
