import { InteractionEvent } from '@logto/schemas';

import { abrirCanalPush, abrirCanalQr, leerConfigCanal } from './api';

/**
 * El cliente del canal, en su borde: **qué se llama y en qué orden**.
 *
 * El caso que importa es el primero. Las rutas del canal exigen una interacción de la experiencia
 * viva —es la precondición que impide que una sesión de canal exista fuera de un login en curso
 * (DS-2)—, y en la pantalla de acceso recién cargada no hay ninguna. Abrir sin arrancarla
 * respondía `404 session.interaction_not_found` en cada intento: ni el código se pintaba, ni el
 * push se despachaba, y la pantalla sólo decía «no se pudo abrir». Es lo mismo que hace
 * `getSocialAuthorizationUrl` antes de pedir la URL del conector, y por lo mismo.
 *
 * La lectura de interruptores **no** la arranca, y eso también se prueba: se hace al pintar la
 * pantalla, antes de que nadie haya elegido nada, y crear una interacción ahí sería crear una por
 * visita a la pantalla de acceso.
 */

const orden: string[] = [];

const post = jest.fn(() => ({
  json: async () => ({ verificationId: 'v1' }),
}));
const get = jest.fn(() => ({
  json: async () => ({ channels: { qr: true, push: true }, devicePicker: 'lazy' }),
}));

jest.mock('@/apis/api', () => ({
  __esModule: true,
  default: {
    post: (...argumentos: unknown[]) => {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods
      orden.push(`post ${String(argumentos[0])}`);
      return post();
    },
    get: (...argumentos: unknown[]) => {
      // eslint-disable-next-line @silverhand/fp/no-mutating-methods
      orden.push(`get ${String(argumentos[0])}`);
      return get();
    },
  },
}));

const initInteraction = jest.fn(async () => {
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods
  orden.push('initInteraction');
});

jest.mock('@/apis/experience/interaction', () => ({
  get initInteraction() {
    return initInteraction;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods
  orden.splice(0, orden.length);
});

describe('abrir el canal arranca la interacción primero', () => {
  it('QR: primero la interacción de acceso, después el canal', async () => {
    await abrirCanalQr('h'.repeat(43));

    expect(initInteraction).toHaveBeenCalledWith(InteractionEvent.SignIn);
    expect(orden).toEqual(['initInteraction', 'post /api/experience/verification/te-channel']);
  });

  it('push: igual, y nunca con `Register` (C4)', async () => {
    await abrirCanalPush('ana@example.com');

    expect(initInteraction).toHaveBeenCalledWith(InteractionEvent.SignIn);
    expect(initInteraction).not.toHaveBeenCalledWith(InteractionEvent.Register);
    expect(orden[0]).toBe('initInteraction');
  });

  it('leer los interruptores NO arranca ninguna interacción', async () => {
    await leerConfigCanal();

    expect(initInteraction).not.toHaveBeenCalled();
    expect(orden).toEqual(['get /api/experience/verification/te-channel/config']);
  });
});
