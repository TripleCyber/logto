import { TeApiClient } from './client.js';
import { type ConfigTe } from './config.js';
import { TeChannelError } from './errors.js';
import { cabeceraFirma, cabeceraKeyId, cabeceraNonce, cabeceraMarcaTiempo } from './hmac.js';

const { jest } = import.meta;

const secreto = Buffer.alloc(32, 3);

/** Ejecuta y devuelve el error en vez de propagarlo, sin usar `.catch()`. */
const capturar = async (accion: Promise<unknown>): Promise<unknown> => {
  try {
    return await accion;
  } catch (error: unknown) {
    return error;
  }
};

const config: ConfigTe = {
  baseUrl: 'http://127.0.0.1:3010',
  claves: [{ kid: '2026-08', secreto }],
  kidActivo: '2026-08',
  timeoutMs: 50,
  maxEnVuelo: 2,
  fallosParaAbrir: 2,
  reposoCortacircuitosMs: 10_000,
  pisoLatenciaErrorMs: 0,
  ttlInterruptoresMs: 10_000,
  politicaSelectorDispositivos: 'lazy',
};

const respuestaJson = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const fetchSimulado = jest.fn<
  Promise<Response>,
  [string | URL | Request, RequestInit | undefined]
>();

beforeEach(() => {
  fetchSimulado.mockReset();
  // eslint-disable-next-line @silverhand/fp/no-mutation
  globalThis.fetch = fetchSimulado as unknown as typeof globalThis.fetch;
});

describe('sobre firmado', () => {
  it('manda las cuatro cabeceras del sobre y el cuerpo firmado, una sola serialización', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: false }));

    const cliente = new TeApiClient(config);
    await capturar(cliente.crearSesionQr('txn-1', 'hash-1'));

    const [url, opciones] = fetchSimulado.mock.calls[0]!;
    const cabeceras = opciones?.headers as Record<string, string>;

    expect(String(url)).toBe('http://127.0.0.1:3010/v1/s2s/qr/sessions');
    expect(cabeceras[cabeceraKeyId]).toBe('2026-08');
    expect(cabeceras[cabeceraNonce]).toBeTruthy();
    expect(cabeceras[cabeceraMarcaTiempo]).toBeTruthy();
    expect(cabeceras[cabeceraFirma]).toBeTruthy();
    expect(opciones?.body).toBe(JSON.stringify({ txnId: 'txn-1', channelHash: 'hash-1' }));
  });

  it('nunca pone el secreto en la petición', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: true }));

    await new TeApiClient(config).interruptores();

    const serializado = JSON.stringify(fetchSimulado.mock.calls[0]);

    expect(serializado).not.toContain(secreto.toString('base64'));
    expect(serializado).not.toContain(secreto.toString('base64url'));
  });

  it('corta la petición con un `AbortSignal`: te-api lento no cuelga la Experience API', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: true }));

    await new TeApiClient(config).interruptores();

    expect(fetchSimulado.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchSimulado.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
});

describe('errores', () => {
  it('convierte un no-2xx en error interno y guarda el requestId de te-api para el log', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ error: 'cannot_complete', requestId: 'r-1' }, 403)
    );

    const error = await capturar(new TeApiClient(config).crearSesionQr('txn', 'hash'));

    expect(error).toBeInstanceOf(TeChannelError);
    expect((error as TeChannelError).requestId).toBe('r-1');
  });

  it('rechaza una respuesta fuera de contrato en vez de reenviarla', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ sessionId: 42 }));

    await expect(new TeApiClient(config).crearSesionQr('txn', 'hash')).rejects.toBeInstanceOf(
      TeChannelError
    );
  });

  it('convierte un fallo de red en error interno, no en una excepción de `fetch`', async () => {
    fetchSimulado.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await capturar(new TeApiClient(config).crearSesionQr('txn', 'hash'));

    expect(error).toBeInstanceOf(TeChannelError);
    expect((error as TeChannelError).motivo).toContain('inalcanzable');
  });
});

describe('contrapresión y cortacircuitos', () => {
  it('rechaza en el acto al superar el tope en vuelo en vez de encolar', async () => {
    fetchSimulado.mockImplementation(
      async () =>
        new Promise<Response>(() => {
          // Nunca resuelve: simula te-api colgado.
        })
    );

    const cliente = new TeApiClient(config);
    const enVuelo = [
      capturar(cliente.crearSesionQr('a', 'h')),
      capturar(cliente.crearSesionQr('b', 'h')),
    ];

    const error = await capturar(cliente.crearSesionQr('c', 'h'));

    expect(error).toBeInstanceOf(TeChannelError);
    expect((error as TeChannelError).motivo).toContain('contrapresión');
    // Sólo se abrieron `maxEnVuelo` conexiones: la tercera ni salió.
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(enVuelo).toHaveLength(2);
  });

  it('deja de intentarlo tras N fallos seguidos', async () => {
    fetchSimulado.mockRejectedValue(new Error('caído'));

    const cliente = new TeApiClient(config);

    await capturar(cliente.crearSesionQr('a', 'h'));
    await capturar(cliente.crearSesionQr('b', 'h'));

    const error = await capturar(cliente.crearSesionQr('c', 'h'));

    expect((error as TeChannelError).motivo).toContain('cortacircuitos');
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });

  it('un éxito reinicia la cuenta de fallos', async () => {
    fetchSimulado.mockRejectedValueOnce(new Error('caído'));
    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: true }));

    const cliente = new TeApiClient(config);

    await capturar(cliente.crearSesionQr('a', 'h'));
    await cliente.interruptores();

    fetchSimulado.mockRejectedValueOnce(new Error('caído'));
    const error = await capturar(cliente.crearSesionQr('b', 'h'));

    // Sigue siendo un fallo normal, no el cortacircuitos.
    expect((error as TeChannelError).motivo).toContain('inalcanzable');
  });
});

describe('interruptores de canal', () => {
  it('devuelve todo apagado si te-api no contesta (fail-closed)', async () => {
    fetchSimulado.mockRejectedValue(new Error('caído'));

    expect(await new TeApiClient(config).interruptores()).toEqual({ qr: false, push: false });
  });

  it('no cachea el fallo: en cuanto te-api vuelve, el canal se vuelve a ofrecer', async () => {
    fetchSimulado.mockRejectedValueOnce(new Error('caído'));

    const cliente = new TeApiClient(config);

    expect(await cliente.interruptores()).toEqual({ qr: false, push: false });

    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: true }));

    expect(await cliente.interruptores()).toEqual({ qr: true, push: true });
  });

  it('cachea el éxito durante el TTL', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ qr: true, push: true }));

    const cliente = new TeApiClient(config);

    await cliente.interruptores();
    await cliente.interruptores();

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });
});
