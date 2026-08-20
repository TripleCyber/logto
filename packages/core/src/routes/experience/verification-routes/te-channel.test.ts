import { createHash } from 'node:crypto';

import { ConnectorType } from '@logto/connector-kit';
import { InteractionEvent } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';

import RequestError from '#src/errors/RequestError/index.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);

type Next = () => Promise<unknown>;
type RouteHandler = (ctx: Record<string, unknown>, next: Next) => Promise<unknown>;

const passThrough = async (_ctx: unknown, next: Next) => next();

/** `base64url(sha256(verifier))`, igual que lo calcula el navegador. */
const huellaDe = (verifier: string) =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url');

/** Devuelve `undefined` sin cuerpo vacío, para los dobles que sólo tienen que resolver. */
const nada = async (): Promise<void> => {
  // Deliberadamente vacío.
};

/** Ejecuta y se traga el error, sin usar `.catch()`. */
const capturar = async (accion: Promise<unknown>): Promise<void> => {
  try {
    await accion;
  } catch {
    // El test mira los efectos, no el error.
  }
};

mockEsm('#src/middleware/koa-guard.js', () => ({ default: () => passThrough }));
mockEsm('../middleware/koa-experience-verifications-audit-log.js', () => ({
  default: () => passThrough,
}));

const assertSocialSignInConnectorEnabled = jest.fn(nada);

mockEsm('#src/libraries/verification-helpers/social-verification.js', () => ({
  assertSocialSignInConnectorEnabled,
}));

const createAuthorizationUrl = jest.fn(
  async () =>
    'http://127.0.0.1:3010/oauth/authorize?client_id=te&state=st-1&code_challenge=cc&redirect_uri=https%3A%2F%2Flogto.test%2Fcallback%2Fconector-te'
);
const verify = jest.fn(nada);
const verificacion = { id: 'verificacion-1', createAuthorizationUrl, verify };

mockEsm('../classes/verifications/social-verification.js', () => ({
  SocialVerification: { create: jest.fn(() => verificacion) },
}));

const configSimulada = {
  baseUrl: 'http://127.0.0.1:3010',
  claves: [{ kid: 'k', secreto: Buffer.alloc(32, 1) }],
  kidActivo: 'k',
  timeoutMs: 100,
  maxEnVuelo: 8,
  fallosParaAbrir: 5,
  reposoCortacircuitosMs: 100,
  pisoLatenciaErrorMs: 0,
  ttlInterruptoresMs: 100,
  politicaSelectorDispositivos: 'lazy',
};

/**
 * La configuración se cambia con `mockReturnValue`, no reasignando una variable: apagarla a mitad
 * de la suite es parte de lo que se prueba (fail-closed).
 */
/** El canal apagado por falta de configuración. */
const sinConfiguracion = undefined;

const configTe = jest.fn<typeof configSimulada | undefined, never[]>(() => configSimulada);

mockEsm('#src/te/config.js', () => ({
  configTe,
  objetivoConectorTe: 'tripleenable',
}));

const cliente = {
  interruptores: jest.fn(async () => ({ qr: true, push: true })),
  crearTransaccion: jest.fn(async () => ({ txnId: 'txn-1', expiresAt: 'luego' })),
  crearSesionQr: jest.fn(async () => ({
    sessionId: 'sesion-1',
    channelSecret: 'secreto-del-canal',
    expiresAt: 'luego',
    code: { codeId: 'c1', uri: 'te://c1', seq: 1, displayExpiresAt: 'a', hardExpiresAt: 'b' },
  })),
  rotarCodigo: jest.fn(),
  estadoSesionQr: jest.fn(async () => ({ frame: { t: 'code' }, retryAfterMs: 4000 })),
  estadoPush: jest.fn(async () => ({ t: 'expired' })),
  confirmarSesionQr: jest.fn(async () => ({
    redirectTo: 'https://logto.test/callback/conector-te?code=el-code-secreto&state=st-1',
  })),
  confirmarRetoPush: jest.fn(),
  despacharPush: jest.fn(async () => ({
    challengeId: 'reto-1',
    expiresAt: 'luego',
    matchDigits: '42',
  })),
  listarDispositivos: jest.fn<
    Promise<{ devices: Array<Record<string, string>> }>,
    [string, string]
  >(async () => ({ devices: [] })),
};

mockEsm('#src/te/client.js', () => ({ clienteTe: () => cliente }));

const leerEstadoCanal = jest.fn();
const escribirEstadoCanal = jest.fn(nada);
const borrarEstadoCanal = jest.fn(nada);

mockEsm('#src/te/storage.js', () => ({
  leerEstadoCanal,
  escribirEstadoCanal,
  borrarEstadoCanal,
}));

/**
 * El catálogo de aplicaciones y el proveedor, para resolver **qué RP** originó el login.
 *
 * Son dobles y no un `{}` porque el fallo de esta resolución también es un caso: la ruta tiene que
 * seguir abriendo el canal aunque la aplicación no se pueda mirar.
 */
const findApplicationById = jest.fn<Promise<unknown>, [string]>();
const safeFindSignInExperienceByApplicationId = jest.fn<Promise<unknown>, [string]>();
const buscarClienteOidc = jest.fn<Promise<unknown>, [string]>();

/** Care Store tal y como vive en la tabla de aplicaciones. */
const aplicacionCareStore = {
  id: 'aplicacion-de-care-store',
  name: 'Care Store',
  oidcClientMetadata: { redirectUris: ['https://care.example/callback'] },
};

const { default: teChannelRoutes } = await import('./te-channel.js');

const prefijo = '/experience/verification/te-channel';

const registrar = () => {
  const router = {
    get: jest.fn<void, [string, ...unknown[]]>(),
    post: jest.fn<void, [string, ...unknown[]]>(),
    use: jest.fn<void, [string, ...unknown[]]>(),
  };

  teChannelRoutes(
    router as never,
    {
      libraries: {},
      queries: {
        applications: { findApplicationById },
        applicationSignInExperiences: { safeFindSignInExperienceByApplicationId },
      },
      connectors: {
        getLogtoConnectors: async () => [
          {
            type: ConnectorType.Social,
            metadata: { target: 'tripleenable' },
            dbEntry: { id: 'conector-te' },
          },
        ],
      },
      provider: { Client: { find: buscarClienteOidc } },
      envSet: { endpoint: new URL('https://logto.test') },
    } as never
  );

  return router;
};

const handler = (metodo: 'get' | 'post', ruta: string): RouteHandler => {
  const router = registrar();
  const llamada = router[metodo].mock.calls.find(([registrada]) => registrada === ruta);

  if (!llamada) {
    throw new TypeError(`ruta no registrada: ${metodo.toUpperCase()} ${ruta}`);
  }

  const ultimo = llamada.at(-1);

  if (typeof ultimo !== 'function') {
    throw new TypeError('el handler registrado no es una función');
  }

  return ultimo as RouteHandler;
};

const contexto = ({
  interactionEvent = InteractionEvent.SignIn,
  body,
  verifier,
  clientId = aplicacionCareStore.id,
}: {
  interactionEvent?: InteractionEvent;
  body?: unknown;
  verifier?: string;
  /** Una cadena vacía representa la interacción de la que no se puede sacar ninguna RP. */
  clientId?: string;
} = {}) => ({
  experienceInteraction: {
    interactionEvent,
    setVerificationRecord: jest.fn(),
    save: jest.fn(nada),
    skipCaptcha: jest.fn(),
    getVerificationRecordByTypeAndId: jest.fn(() => verificacion),
  },
  /**
   * Lo que deja `koaInteractionDetails`: el estado de la interacción viva, recuperado del almacén
   * de oidc-provider. **No es un parámetro que el navegador mande en esta petición**, y de eso
   * depende que el nombre que sale de aquí se pueda pintar en la pantalla de aprobación.
   */
  interactionDetails: { params: { client_id: clientId } },
  verificationAuditLog: { append: jest.fn() },
  request: {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'Firefox', ...(verifier ? { 'x-channel-verifier': verifier } : {}) },
  },
  guard: { body },
  body: undefined as unknown,
});

const siguiente = nada;

/** El cuarto argumento de `crearTransaccion`: la RP. Sin indexar una tupla declarada vacía. */
const rpEnviada = () => (cliente.crearTransaccion.mock.calls[0] as unknown[] | undefined)?.[3];

const abrirCanal = async (clientId?: string) =>
  handler('post', prefijo)(
    contexto({ body: { channel: 'qr', channelHash: 'h' }, clientId }),
    siguiente
  );

beforeEach(() => {
  jest.clearAllMocks();
  configTe.mockReturnValue(configSimulada);
  // `mockReset` en vez de `mockResolvedValue(undefined)`: sin implementación, el doble devuelve
  // `undefined`, que es justo «no hay canal abierto».
  leerEstadoCanal.mockReset();
  assertSocialSignInConnectorEnabled.mockReset();
  cliente.interruptores.mockResolvedValue({ qr: true, push: true });
  // Los dobles de la RP se reponen enteros: `clearAllMocks` no borra implementaciones, y el
  // `mockRejectedValue` de un caso de fallo contaminaría los siguientes.
  findApplicationById.mockReset().mockResolvedValue(aplicacionCareStore);
  safeFindSignInExperienceByApplicationId.mockReset().mockResolvedValue(null);
  // Sin implementación devuelve `undefined`, que es justo «el proveedor no conoce ese cliente».
  buscarClienteOidc.mockReset();
});

describe('registro de rutas', () => {
  it('cuelga el nivelador de errores del prefijo, no de cada ruta, para envolver también a koaGuard', () => {
    const router = registrar();

    expect(router.use).toHaveBeenCalledWith(prefijo, expect.any(Function));
  });

  it('expone exactamente las rutas del contrato', () => {
    const router = registrar();

    // `/events` es el aviso en tiempo real (`te-channel-eventos.ts`). Se registra
    // desde este mismo módulo a propósito: la superficie del canal se lee entera
    // aquí, y una ruta que se registre por su cuenta en otro sitio es una ruta
    // que este test deja de vigilar.
    expect(router.get.mock.calls.map(([ruta]) => ruta)).toEqual([
      `${prefijo}/events`,
      `${prefijo}/config`,
    ]);
    expect(router.post.mock.calls.map(([ruta]) => ruta)).toEqual([
      prefijo,
      `${prefijo}/code`,
      `${prefijo}/poll`,
      `${prefijo}/confirm`,
      `${prefijo}/push`,
      `${prefijo}/push/devices`,
    ]);
  });
});

describe('C4 · en el alta no se puede continuar con TripleEnable', () => {
  it.each([
    [prefijo, { channel: 'qr', channelHash: 'h' }],
    [`${prefijo}/confirm`, undefined],
    [`${prefijo}/push`, {}],
    [`${prefijo}/push/devices`, undefined],
  ])('%s rechaza una interacción de alta aunque se llame a mano', async (ruta, body) => {
    const ctx = contexto({ interactionEvent: InteractionEvent.Register, body });

    const error = await handler('post', ruta)(ctx, siguiente).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).code).toBe('user.identity_not_exist');
    expect((error as RequestError).status).toBe(403);
  });

  it('rechaza el alta antes de tocar te-api', async () => {
    const ctx = contexto({
      interactionEvent: InteractionEvent.Register,
      body: { channel: 'qr', channelHash: 'h' },
    });

    await capturar(handler('post', prefijo)(ctx, siguiente));

    expect(cliente.crearTransaccion).not.toHaveBeenCalled();
    expect(cliente.crearSesionQr).not.toHaveBeenCalled();
  });
});

describe('interruptor del conector en consola', () => {
  it('la ruta del canal aplica el interruptor que upstream sólo aplica en createSocialAuthorizationUrl', async () => {
    assertSocialSignInConnectorEnabled.mockRejectedValue(
      new RequestError({ code: 'entity.not_found', status: 404 })
    );

    const ctx = contexto({ body: { channel: 'qr', channelHash: 'h' } });
    const error = await handler('post', prefijo)(ctx, siguiente).catch((error: unknown) => error);

    expect((error as RequestError).code).toBe('entity.not_found');
    expect((error as RequestError).status).toBe(404);
  });
});

describe('interruptores: el apagado se nota en la UI, no en un 4xx al usarlo', () => {
  it('refleja lo que dice te-api', async () => {
    cliente.interruptores.mockResolvedValue({ qr: true, push: false });

    const ctx = contexto();
    await handler('get', `${prefijo}/config`)(ctx, siguiente);

    expect(ctx.body).toEqual({ channels: { qr: true, push: false }, devicePicker: 'lazy' });
  });

  it('sin configuración responde todo apagado en vez de fallar', async () => {
    configTe.mockReturnValue(sinConfiguracion);

    const ctx = contexto();
    await handler('get', `${prefijo}/config`)(ctx, siguiente);

    expect(ctx.body).toEqual({ channels: { qr: false, push: false }, devicePicker: 'lazy' });
  });

  it('con el conector apagado en consola responde todo apagado, sin preguntar a te-api', async () => {
    assertSocialSignInConnectorEnabled.mockRejectedValue(
      new RequestError({ code: 'entity.not_found', status: 404 })
    );

    const ctx = contexto();
    await handler('get', `${prefijo}/config`)(ctx, siguiente);

    expect(ctx.body).toEqual({ channels: { qr: false, push: false }, devicePicker: 'lazy' });
    expect(cliente.interruptores).not.toHaveBeenCalled();
  });

  it('no abre el canal si te-api dice que está apagado', async () => {
    cliente.interruptores.mockResolvedValue({ qr: false, push: true });

    const ctx = contexto({ body: { channel: 'qr', channelHash: 'h' } });

    await expect(handler('post', prefijo)(ctx, siguiente)).rejects.toThrow();
    expect(cliente.crearSesionQr).not.toHaveBeenCalled();
  });
});

describe('apertura del canal', () => {
  it('mide la IP del navegador y se la pasa firmada a te-api (NW-1)', async () => {
    const ctx = contexto({ body: { channel: 'qr', channelHash: 'hash-del-navegador' } });

    await handler('post', prefijo)(ctx, siguiente);

    expect(cliente.crearTransaccion).toHaveBeenCalledWith(
      expect.stringContaining('/oauth/authorize?'),
      { ip: '203.0.113.9', userAgent: 'Firefox' },
      undefined,
      expect.anything()
    );
  });

  it('no devuelve al navegador ni el txnId ni el secreto del canal', async () => {
    const ctx = contexto({ body: { channel: 'qr', channelHash: 'h' } });

    await handler('post', prefijo)(ctx, siguiente);

    const serializado = JSON.stringify(ctx.body);

    expect(serializado).not.toContain('txn-1');
    expect(serializado).not.toContain('secreto-del-canal');
    expect(ctx.body).toEqual({
      verificationId: 'verificacion-1',
      sessionId: 'sesion-1',
      expiresAt: 'luego',
      code: { codeId: 'c1', uri: 'te://c1', seq: 1, displayExpiresAt: 'a', hardExpiresAt: 'b' },
    });
  });

  it('guarda el estado del canal colgado de la interacción OIDC, no de un identificador paralelo', async () => {
    const ctx = contexto({ body: { channel: 'qr', channelHash: 'h' } });

    await handler('post', prefijo)(ctx, siguiente);

    expect(escribirEstadoCanal).toHaveBeenCalledWith(ctx, expect.anything(), {
      canal: 'qr',
      txnId: 'txn-1',
      verificationId: 'verificacion-1',
      connectorId: 'conector-te',
      sessionId: 'sesion-1',
      // El hash es el que declaró el navegador al abrir el canal, tal cual.
      credenciales: { channelSecret: 'secreto-del-canal', channelHash: 'h' },
    });
  });

  it('pasa el identificador a te-api como login_hint y no lo registra en auditoría', async () => {
    const ctx = contexto({ body: { channel: 'push', loginHint: 'ana@example.com' } });

    await handler('post', prefijo)(ctx, siguiente);

    expect(cliente.crearTransaccion).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      'ana@example.com',
      expect.anything()
    );
    expect(
      JSON.stringify(ctx.experienceInteraction.setVerificationRecord.mock.calls)
    ).not.toContain('ana@example.com');
    expect(JSON.stringify(ctx.verificationAuditLog.append.mock.calls)).not.toContain(
      'ana@example.com'
    );
    expect(ctx.body).toEqual({ verificationId: 'verificacion-1' });
  });
});

/**
 * **Quién pidió entrar de verdad.**
 *
 * te-api sólo conoce al conector de Logto —se presenta con SU `client_id`—, así que sin este dato
 * la cartera enseñaba «Logto»: fontanería que la persona no ha visto nunca, cuando lo que pulsó
 * fue «entrar» en Care Store.
 *
 * Aquí se comprueba el cableado —de dónde sale el identificador y qué llega a te-api— y la
 * propiedad que lo gobierna: **resolver la aplicación no puede tumbar un acceso**. Es adorno de una
 * pantalla; el peor resultado admisible es mandar el identificador desnudo y que te-api caiga a lo
 * de siempre. Los caminos de resolución, uno a uno, están en `te/route-helpers.test.ts`.
 */
describe('la aplicación que originó el login viaja hasta te-api', () => {
  it('la resuelve desde `interactionDetails` y se la pasa a te-api', async () => {
    await abrirCanal();

    expect(findApplicationById).toHaveBeenCalledWith('aplicacion-de-care-store');
    expect(rpEnviada()).toEqual({
      id: 'aplicacion-de-care-store',
      name: 'Care Store',
      // Recortado del `redirect_uri` registrado: lo que la persona contrasta es la marca, no una
      // ruta de callback. Los caminos de resolución se prueban en `te/route-helpers.test.ts`.
      origin: 'https://care.example',
    });
  });

  it('con el catálogo y el proveedor rotos manda el identificador desnudo y abre igual', async () => {
    findApplicationById.mockRejectedValue(new Error('la base no contesta'));
    buscarClienteOidc.mockRejectedValue(new Error('tampoco'));

    const ctx = contexto({ body: { channel: 'qr', channelHash: 'h' } });
    await handler('post', prefijo)(ctx, siguiente);

    expect(rpEnviada()).toEqual({ id: 'aplicacion-de-care-store' });
    // Y el login sigue: la resolución es adorno de una pantalla, no un control.
    expect(ctx.body).toMatchObject({ verificationId: 'verificacion-1' });
  });

  it('sin identificador de aplicación no manda nada, y te-api cae a su cliente OAuth', async () => {
    await abrirCanal('');

    // Ni siquiera se consulta el catálogo: eso lo fija `te/route-helpers.test.ts`.
    expect(rpEnviada()).toBeUndefined();
  });
});

describe('confirmación: aquí muere el code OAuth2', () => {
  const estadoQr = {
    canal: 'qr',
    txnId: 'txn-1',
    verificationId: 'verificacion-1',
    connectorId: 'conector-te',
    sessionId: 'sesion-1',
    credenciales: { channelSecret: 'secreto-del-canal', channelHash: huellaDe('el-verifier') },
  };

  it('canjea el code en el servidor y devuelve sólo el verificationId', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    const ctx = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/confirm`)(ctx, siguiente);

    expect(verify).toHaveBeenCalledWith(ctx, expect.anything(), {
      code: 'el-code-secreto',
      state: 'st-1',
    });
    expect(ctx.body).toEqual({ verificationId: 'verificacion-1' });
  });

  it('ni el code ni el state ni el redirectTo cruzan al navegador o al log', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    const ctx = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/confirm`)(ctx, siguiente);

    const serializado =
      JSON.stringify(ctx.body) + JSON.stringify(ctx.verificationAuditLog.append.mock.calls);

    expect(serializado).not.toContain('el-code-secreto');
    expect(serializado).not.toContain('st-1');
    expect(serializado).not.toContain('callback');
  });

  it('manda el verifier por cabecera y nunca por query', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    const ctx = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/confirm`)(ctx, siguiente);

    expect(cliente.confirmarSesionQr).toHaveBeenCalledWith('sesion-1', {
      channelSecret: 'secreto-del-canal',
      verifier: 'el-verifier',
    });
  });

  it('un verifier que no cuadra con el hash declarado no confirma', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    await expect(
      handler('post', `${prefijo}/confirm`)(contexto({ verifier: 'otro' }), siguiente)
    ).rejects.toThrow();
    expect(cliente.confirmarSesionQr).not.toHaveBeenCalled();
  });

  it('sin verifier no confirma', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    await expect(handler('post', `${prefijo}/confirm`)(contexto(), siguiente)).rejects.toThrow();
    expect(cliente.confirmarSesionQr).not.toHaveBeenCalled();
  });

  it('borra el estado del canal en cuanto el code se ha redimido', async () => {
    leerEstadoCanal.mockResolvedValue(estadoQr);

    const ctx = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/confirm`)(ctx, siguiente);

    expect(borrarEstadoCanal).toHaveBeenCalled();
  });
});
