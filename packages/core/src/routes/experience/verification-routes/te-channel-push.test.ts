import { createHash } from 'node:crypto';

import { ConnectorType } from '@logto/connector-kit';
import { InteractionEvent } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';

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
  estadoSesionQr: jest.fn(async () => ({ t: 'code' })),
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
      queries: {},
      connectors: {
        getLogtoConnectors: async () => [
          {
            type: ConnectorType.Social,
            metadata: { target: 'tripleenable' },
            dbEntry: { id: 'conector-te' },
          },
        ],
      },
      provider: {},
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
}: {
  interactionEvent?: InteractionEvent;
  body?: unknown;
  verifier?: string;
} = {}) => ({
  experienceInteraction: {
    interactionEvent,
    setVerificationRecord: jest.fn(),
    save: jest.fn(nada),
    skipCaptcha: jest.fn(),
    getVerificationRecordByTypeAndId: jest.fn(() => verificacion),
  },
  verificationAuditLog: { append: jest.fn() },
  request: {
    ip: '203.0.113.9',
    headers: { 'user-agent': 'Firefox', ...(verifier ? { 'x-channel-verifier': verifier } : {}) },
  },
  guard: { body },
  body: undefined as unknown,
});

const siguiente = nada;

beforeEach(() => {
  jest.clearAllMocks();
  configTe.mockReturnValue(configSimulada);
  // `mockReset` en vez de `mockResolvedValue(undefined)`: sin implementación, el doble devuelve
  // `undefined`, que es justo «no hay canal abierto».
  leerEstadoCanal.mockReset();
  assertSocialSignInConnectorEnabled.mockReset();
  cliente.interruptores.mockResolvedValue({ qr: true, push: true });
});

describe('C3 · push y selector de dispositivos con PU-12 dentro', () => {
  const estadoPush = {
    canal: 'push',
    txnId: 'txn-1',
    verificationId: 'verificacion-1',
    connectorId: 'conector-te',
  };

  it('el primer despacho va sin deviceRef y no enseña nada de la flota', async () => {
    leerEstadoCanal.mockResolvedValue(estadoPush);

    const ctx = contexto({ body: {} });
    await handler('post', `${prefijo}/push`)(ctx, siguiente);

    expect(cliente.despacharPush).toHaveBeenCalledWith('txn-1', undefined);
    expect(Object.keys(ctx.body as Record<string, unknown>)).toEqual([
      'challengeId',
      'expiresAt',
      'matchDigits',
    ]);
  });

  it('la lista está cerrada mientras no haya fallado ningún reto', async () => {
    leerEstadoCanal.mockResolvedValue({ ...estadoPush, challengeId: 'reto-1' });

    await expect(
      handler('post', `${prefijo}/push/devices`)(contexto(), siguiente)
    ).rejects.toThrow();
    expect(cliente.listarDispositivos).not.toHaveBeenCalled();
  });

  it('un reto caducado la desbloquea; uno aprobado no', async () => {
    leerEstadoCanal.mockResolvedValue({ ...estadoPush, challengeId: 'reto-1' });
    cliente.estadoPush.mockResolvedValue({ t: 'expired' });

    await handler('post', `${prefijo}/poll`)(contexto(), siguiente);

    expect(escribirEstadoCanal).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ selectorDesbloqueado: true })
    );

    escribirEstadoCanal.mockClear();
    cliente.estadoPush.mockResolvedValue({ t: 'approved' });

    await handler('post', `${prefijo}/poll`)(contexto(), siguiente);

    expect(escribirEstadoCanal).not.toHaveBeenCalled();
  });

  it('una vez desbloqueada devuelve como mucho 5, en orden y enmascaradas', async () => {
    leerEstadoCanal.mockResolvedValue({
      ...estadoPush,
      challengeId: 'reto-1',
      selectorDesbloqueado: true,
    });
    cliente.listarDispositivos.mockResolvedValue({
      devices: Array.from({ length: 7 }, (_, indice) => ({
        deviceRef: `ref-${indice}`,
        kind: 'phone',
        lastSeen: 'today',
        name: `Teléfono de Ana ${indice}`,
        lastSeenAt: '2026-08-14T10:00:00.000Z',
      })),
    });

    const ctx = contexto();
    await handler('post', `${prefijo}/push/devices`)(ctx, siguiente);

    const { devices } = ctx.body as { devices: Array<Record<string, string>> };

    expect(devices).toHaveLength(5);
    expect(devices.map(({ deviceRef }) => deviceRef)).toEqual([
      'ref-0',
      'ref-1',
      'ref-2',
      'ref-3',
      'ref-4',
    ]);
    expect(JSON.stringify(devices)).not.toContain('Teléfono de Ana');
    expect(JSON.stringify(devices)).not.toContain('2026-08-14');
    expect(Object.keys(devices[0]!)).toEqual(['deviceRef', 'kind', 'lastSeen']);
  });

  it('con TE_PUSH_DEVICE_PICKER=eager la lista se abre sin gastar ningún push', async () => {
    configTe.mockReturnValue({ ...configSimulada, politicaSelectorDispositivos: 'eager' });
    leerEstadoCanal.mockResolvedValue({ ...estadoPush, challengeId: 'reto-1' });
    cliente.listarDispositivos.mockResolvedValue({ devices: [] });

    const ctx = contexto();
    await handler('post', `${prefijo}/push/devices`)(ctx, siguiente);

    expect(cliente.listarDispositivos).toHaveBeenCalled();
  });

  it('un despacho dirigido pasa el deviceRef opaco tal cual', async () => {
    leerEstadoCanal.mockResolvedValue(estadoPush);

    await handler('post', `${prefijo}/push`)(contexto({ body: { deviceRef: 'ref-3' } }), siguiente);

    expect(cliente.despacharPush).toHaveBeenCalledWith('txn-1', 'ref-3');
  });
});

describe('sondeo', () => {
  it('dicta el ritmo desde el servidor y para en los estados terminales', async () => {
    leerEstadoCanal.mockResolvedValue({
      canal: 'qr',
      txnId: 'txn-1',
      verificationId: 'v',
      connectorId: 'c',
      sessionId: 's',
      credenciales: { channelSecret: 'sec', channelHash: huellaDe('el-verifier') },
    });

    cliente.estadoSesionQr.mockResolvedValue({ t: 'code' });
    const conCodigo = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/poll`)(conCodigo, siguiente);
    expect(conCodigo.body).toEqual({ frame: { t: 'code' }, retryAfterMs: 1500 });

    cliente.estadoSesionQr.mockResolvedValue({ t: 'claimed' });
    const reclamado = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/poll`)(reclamado, siguiente);
    expect(reclamado.body).toEqual({ frame: { t: 'claimed' }, retryAfterMs: 700 });

    cliente.estadoSesionQr.mockResolvedValue({ t: 'approved' });
    const aprobado = contexto({ verifier: 'el-verifier' });
    await handler('post', `${prefijo}/poll`)(aprobado, siguiente);
    expect(aprobado.body).toEqual({ frame: { t: 'approved' }, retryAfterMs: 0 });
  });

  it('no hay canal que sondear si no hay uno abierto en esta interacción (DS-2)', async () => {
    leerEstadoCanal.mockReset();

    await expect(handler('post', `${prefijo}/poll`)(contexto(), siguiente)).rejects.toThrow();
  });
});
