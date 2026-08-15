import RequestError from '#src/errors/RequestError/index.js';

import { olvidarConfigTe } from './config.js';
import { codigoErrorCanal, koaTeChannelUniformErrors, TeChannelError } from './errors.js';

const pisoMs = 40;

/** Siguiente eslabón que no hace nada: el sujeto del test es el middleware, no lo que envuelve. */
const nada = async (): Promise<void> => {
  // Deliberadamente vacío.
};

beforeAll(() => {
  process.env.TE_API_BASE_URL = 'http://127.0.0.1:3010';
  process.env.TE_LOGTO_HMAC_KEYS = `2026-08:${Buffer.alloc(32, 9).toString('base64')}`;
  process.env.TE_CHANNEL_ERROR_LATENCY_MS = String(pisoMs);

  olvidarConfigTe();
});

const contexto = () => ({ console: undefined });

/** Ejecuta el middleware y devuelve lo que salga, error incluido, sin usar `.catch()`. */
const ejecutar = async (fallo: unknown): Promise<unknown> => {
  const middleware = koaTeChannelUniformErrors();

  try {
    await middleware(contexto() as never, async () => {
      throw fallo;
    });
  } catch (error: unknown) {
    return error;
  }
};

describe('uniformidad de los errores del canal', () => {
  it.each([
    new TeChannelError('sesión inexistente'),
    new TeChannelError('verifier malo'),
    new TeChannelError('te-api caído', 'req-1'),
    new TeChannelError('contrapresión'),
    new RequestError({ code: 'session.verification_expired', status: 400 }),
    new RequestError({ code: 'guard.invalid_input', status: 400 }),
    new Error('cualquier otra cosa'),
  ])('responde siempre el mismo 400 pase lo que pase (%#)', async (fallo) => {
    const error = await ejecutar(fallo);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).code).toBe(codigoErrorCanal);
    expect((error as RequestError).status).toBe(400);
  });

  it('nunca deja escapar el motivo real hacia el cuerpo de la respuesta', async () => {
    const error = await ejecutar(
      new TeChannelError('la sesión qr-123 no existe para el txn abc', 'req-9')
    );

    const uniforme = error as RequestError;
    const cuerpo = JSON.stringify({
      code: uniforme.code,
      data: uniforme.data,
      details: uniforme.details,
      message: uniforme.message,
    });

    expect(cuerpo).not.toContain('qr-123');
    expect(cuerpo).not.toContain('req-9');
    expect(cuerpo).not.toContain('txn');
  });

  it('deja pasar los dos errores de configuración, que no hablan de ningún usuario', async () => {
    for (const original of [
      new RequestError({ code: 'user.identity_not_exist', status: 403 }),
      new RequestError({ code: 'entity.not_found', status: 404 }),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const error = await ejecutar(original);

      expect(error).toBe(original);
    }
  });
});

describe('piso de latencia', () => {
  it('nivela cualquier fallo, incluido el del validador de esquema', async () => {
    const inicio = Date.now();

    await ejecutar(new RequestError({ code: 'guard.invalid_input', status: 400 }));

    // Sin el piso, un fallo de esquema responde en ~1 ms y delata qué comprobación falló antes que
    // ninguna otra.
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(pisoMs - 5);
  });

  it('también nivela los errores de configuración que pasan verbatim', async () => {
    const inicio = Date.now();

    await ejecutar(new RequestError({ code: 'user.identity_not_exist', status: 403 }));

    expect(Date.now() - inicio).toBeGreaterThanOrEqual(pisoMs - 5);
  });

  it('no penaliza el camino de éxito', async () => {
    const middleware = koaTeChannelUniformErrors();
    const inicio = Date.now();

    await middleware(contexto() as never, nada);

    expect(Date.now() - inicio).toBeLessThan(pisoMs);
  });
});
