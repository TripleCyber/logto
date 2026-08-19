import {
  borrarEstadoCanal,
  escribirEstadoCanal,
  leerCanalCompletado,
  leerEstadoCanal,
} from './storage.js';

const { jest } = import.meta;

const estado = {
  canal: 'qr' as const,
  txnId: 'txn-1',
  verificationId: 'v-1',
  connectorId: 'c-1',
  sessionId: 's-1',
  credenciales: { channelSecret: 'secreto', channelHash: 'hash' },
};

/**
 * Doble del proveedor OIDC: guarda el último resultado escrito, que es exactamente lo que hace
 * `provider.interactionResult` con `mergeWithLastSubmission` desactivado.
 */
const crearProveedor = (inicial?: Record<string, unknown>) => {
  const almacen = new Map<'resultado', Record<string, unknown> | undefined>([
    ['resultado', inicial],
  ]);

  return {
    leer: () => almacen.get('resultado'),
    provider: {
      interactionDetails: jest.fn(async () => ({ result: almacen.get('resultado') })),
      interactionResult: jest.fn(
        async (
          _request: unknown,
          _respuesta: unknown,
          resultado: Record<string, unknown> | undefined
        ) => {
          almacen.set('resultado', resultado);
        }
      ),
    },
  };
};

const ctx = { req: {}, res: {} };

describe('el canal cuelga de la interacción OIDC (DS-2)', () => {
  it('no hay canal si la interacción no lo lleva', async () => {
    const { provider } = crearProveedor({ interactionEvent: 'SignIn' });

    expect(await leerEstadoCanal(ctx as never, provider as never)).toBeUndefined();
  });

  it('escribe y relee el estado sin tocar el resto del resultado de la interacción', async () => {
    const { leer, provider } = crearProveedor({ interactionEvent: 'SignIn', userId: 'u-1' });

    await escribirEstadoCanal(ctx as never, provider as never, estado);

    expect(leer()).toMatchObject({ interactionEvent: 'SignIn', userId: 'u-1' });
    expect(await leerEstadoCanal(ctx as never, provider as never)).toEqual(estado);
  });

  it('descarta un estado que no cumple el contrato en vez de creérselo', async () => {
    const { provider } = crearProveedor({ teChannel: { canal: 'telepatía' } });

    expect(await leerEstadoCanal(ctx as never, provider as never)).toBeUndefined();
  });

  it('borrarlo deja la interacción intacta: el secreto del canal no sobrevive al canje', async () => {
    const { leer, provider } = crearProveedor({ interactionEvent: 'SignIn', userId: 'u-1' });

    await escribirEstadoCanal(ctx as never, provider as never, estado);
    await borrarEstadoCanal(ctx as never, provider as never);

    expect(leer()).toMatchObject({ interactionEvent: 'SignIn', userId: 'u-1' });
    expect(JSON.stringify(leer())).not.toContain('secreto');
    // Ni el secreto, ni la sesión, ni la transacción: de todo el estado sólo queda el canal.
    expect(JSON.stringify(leer())).not.toContain('txn-1');
    expect(JSON.stringify(leer())).not.toContain('s-1');
    expect(await leerEstadoCanal(ctx as never, provider as never)).toBeUndefined();
  });

  /**
   * **El hueco que rompía el acceso.** El `submit` corre después de `confirm`, y `confirm` borra el
   * estado. `hasVerifiedTeChannel` leía el estado para saber por qué canal se entró, no lo
   * encontraba y fallaba cerrado: pedía un segundo factor justo después de haberlo aprobado en el
   * teléfono.
   */
  it('tras borrarlo sigue sabiéndose por qué canal se entró', async () => {
    const { provider } = crearProveedor({ interactionEvent: 'SignIn', userId: 'u-1' });

    await escribirEstadoCanal(ctx as never, provider as never, { ...estado, canal: 'push' });
    await borrarEstadoCanal(ctx as never, provider as never);

    expect(await leerCanalCompletado(ctx as never, provider as never)).toBe('push');
  });

  it('antes de borrarlo, el canal sale del estado vivo', async () => {
    const { provider } = crearProveedor({ interactionEvent: 'SignIn' });

    await escribirEstadoCanal(ctx as never, provider as never, estado);

    expect(await leerCanalCompletado(ctx as never, provider as never)).toBe('qr');
  });

  it('sin canal ninguno, no se inventa uno', async () => {
    const { provider } = crearProveedor({ interactionEvent: 'SignIn' });

    expect(await leerCanalCompletado(ctx as never, provider as never)).toBeUndefined();
  });
});
