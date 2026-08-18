import { TeApiClient } from './client.js';
import { type ConfigTe } from './config.js';

const { jest } = import.meta;

/**
 * El contrato de cable con te-api, pinchado con los cuerpos **literales** que el otro servicio
 * emite y acepta.
 *
 * Por qué este fichero existe aparte de `client.test.ts`: allí el `fetch` simulado devuelve lo que
 * al test le conviene, así que los tres fallos que se arreglan aquí pasaban desapercibidos — el
 * cliente y su simulacro coincidían consigo mismos mientras el servicio de verdad hablaba otro
 * idioma. Cada caso de este fichero cita la línea de te-api de la que sale la forma, para que si
 * uno de los dos lados cambia, el que se rompa sea este test y no un login en producción.
 *
 * Referencias (rutas relativas a `tripleenable-api/`):
 *  · `src/routes/s2s.ts:158-172`  — `respuestaMarco`: el marco viaja ENVUELTO en `{frame,
 *    retryAfterMs}`.
 *  · `src/oauth/transaccion.ts:64-74,155` — `login_hint` se lee de los parámetros de autorización.
 *  · `src/routes/s2s.ts:202`      — `cuerpoDispositivos` acepta `eager`, y sin él el selector sigue
 *    cerrado del lado de te-api.
 */

const config: ConfigTe = {
  baseUrl: 'http://127.0.0.1:3010',
  claves: [{ kid: '2026-08', secreto: Buffer.alloc(32, 7) }],
  kidActivo: '2026-08',
  timeoutMs: 50,
  maxEnVuelo: 4,
  fallosParaAbrir: 99,
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

const credenciales = { channelSecret: 'secreto-del-canal', verifier: 'verificador' };

/** Un código tal y como lo serializa `serializarCodigo` en `src/routes/s2s.ts:595`. */
const codigo = {
  codeId: '8f5a2f2e-9a4d-4a3f-8f0a-2c9a1b3c4d5e',
  uri: 'tripleenable://qr?c=8f5a2f2e',
  seq: 1,
  displayExpiresAt: '2026-08-15T10:00:30.000Z',
  hardExpiresAt: '2026-08-15T10:00:45.000Z',
};

const cuerpoEnviado = (llamada: number): Record<string, unknown> =>
  JSON.parse(String(fetchSimulado.mock.calls[llamada]?.[1]?.body ?? '{}')) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  fetchSimulado.mockReset();
  // eslint-disable-next-line @silverhand/fp/no-mutation
  globalThis.fetch = fetchSimulado as unknown as typeof globalThis.fetch;
});

describe('el sondeo llega envuelto', () => {
  it('acepta el cuerpo real de te-api y devuelve el marco de dentro', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ frame: { t: 'code', code: codigo }, retryAfterMs: 1500 })
    );

    const marco = await new TeApiClient(config).estadoSesionQr('sesion-1', credenciales);

    expect(marco).toEqual({ t: 'code', code: codigo });
  });

  /**
   * El push comparte la envoltura y añade una cosa: **a dónde fue el aviso**.
   *
   * Por eso `estadoPush` devuelve `{frame, despacho}` y no el marco pelado — el marco dice en qué
   * punto está el reto, y la etiqueta dice a qué dispositivo salió. Este test se escribió cuando
   * sólo existía lo primero y se quedó comprobando el marco desnudo: seguía compilando, porque lo
   * que cambió es la forma del valor devuelto y no la del cuerpo del cable.
   *
   * `dispatch` llega `null` hasta que el trabajador de fondo de te-api resuelve el identificador
   * —fuera del ciclo de petición, para que la latencia no diga si la cuenta existe (PU-4)—, así que
   * el caso «todavía no se sabe» es el normal en los primeros sondeos y no un error.
   */
  it('lo mismo para el push, que comparte la envoltura', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({ frame: { t: 'approved' }, retryAfterMs: 0, dispatch: null })
    );

    const estado = await new TeApiClient(config).estadoPush('reto-1', 'txn-1');

    expect(estado).toEqual({ frame: { t: 'approved' } });
  });

  it('y cuando te-api ya ha despachado, la etiqueta sale con el marco', async () => {
    fetchSimulado.mockResolvedValue(
      respuestaJson({
        frame: { t: 'claimed' },
        retryAfterMs: 700,
        dispatch: { count: 1, kind: 'phone', lastSeen: 'today' },
      })
    );

    const estado = await new TeApiClient(config).estadoPush('reto-1', 'txn-1');

    /*
     * Sale **tal cual llegó**: quien recorta es la ruta, con `enmascararDespacho`, en el mismo
     * sitio donde se escribe `ctx.body`. Comprobarlo aquí es lo que impide que alguien «arregle»
     * el recorte en el cliente y deje la frontera hacia el navegador en dos sitios distintos.
     */
    expect(estado).toEqual({
      frame: { t: 'claimed' },
      despacho: { count: 1, kind: 'phone', lastSeen: 'today' },
    });
  });

  /**
   * La otra mitad del arreglo: aceptar además el marco desnudo dejaría pasar dos contratos a la
   * vez, y el día que te-api dejara de envolver nadie se enteraría. Se rechaza, que es fail-closed.
   */
  it('rechaza un marco sin envolver en vez de admitir dos contratos', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ t: 'approved' }));

    await expect(new TeApiClient(config).estadoPush('reto-1', 'txn-1')).rejects.toThrow(
      /fuera de contrato/
    );
  });
});

describe('el identificador viaja donde te-api lo lee', () => {
  /**
   * El `client_id` de dentro de `authorize` es el **del conector de Logto ante te-api**, y no el de
   * la aplicación que originó el login. Los dos viven en el mismo cuerpo y son espacios de nombres
   * distintos: confundirlos es literalmente la razón de que la cartera dijera «estás entrando en
   * Logto». La RP viaja aparte, en `rp`; ver el bloque de abajo.
   */
  const url = 'https://te.example/oauth/authorize?client_id=logto-te&state=abc&code_challenge=xyz';

  it('lo mete en `authorize.login_hint`, nunca como campo hermano', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ txnId: 'txn-1', expiresAt: 'ya' }));

    await new TeApiClient(config).crearTransaccion(url, { ip: '203.0.113.7' }, 'vlad@example.test');

    const cuerpo = cuerpoEnviado(0);
    const autorizacion = cuerpo.authorize as Record<string, string>;

    expect(autorizacion.login_hint).toBe('vlad@example.test');
    // El del conector. Que no se le pegue el de la RP ni al revés.
    expect(autorizacion.client_id).toBe('logto-te');
    // Un campo hermano lo descarta el esquema de te-api en silencio, y el reto push nace señuelo.
    expect(Object.keys(cuerpo).slice().sort()).toEqual(['authorize', 'browser']);
  });

  it('sin identificador no inventa la clave', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ txnId: 'txn-1', expiresAt: 'ya' }));

    await new TeApiClient(config).crearTransaccion(url, { ip: '203.0.113.7' });

    expect(Object.keys(cuerpoEnviado(0).authorize as Record<string, unknown>)).not.toContain(
      'login_hint'
    );
  });
});

/**
 * La aplicación que originó el login, en su propia clave de primer nivel.
 *
 * Referencia: `src/routes/s2s.ts` de te-api — `cuerpoTransaccion.rp`. Zod descarta lo que no
 * declara, así que un nombre distinto o un anidamiento distinto no da error: el campo desaparece
 * en silencio y la cartera vuelve a decir «Logto». Por eso esto se comprueba con el cuerpo del
 * cable y no con el valor devuelto.
 */
describe('la RP viaja como campo hermano', () => {
  const url = 'https://te.example/oauth/authorize?client_id=logto-te&state=abc&code_challenge=xyz';

  const rp = {
    id: 'aplicacion-de-care-store',
    name: 'Care Store',
    origin: 'https://care.example',
    logoUrl: 'https://care.example/logo.png',
  };

  it('la manda en `rp`, fuera de `authorize`, sin tocar el `client_id` del conector', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ txnId: 'txn-1', expiresAt: 'ya' }));

    await new TeApiClient(config).crearTransaccion(url, { ip: '203.0.113.7' }, undefined, rp);

    const cuerpo = cuerpoEnviado(0);

    expect(Object.keys(cuerpo).slice().sort()).toEqual(['authorize', 'browser', 'rp']);
    expect(cuerpo.rp).toEqual(rp);
    // Dentro de `authorize` sigue mandando el conector: ahí te-api resuelve `te.oauth_client`.
    expect((cuerpo.authorize as Record<string, string>).client_id).toBe('logto-te');
  });

  /**
   * Omitirla es distinto de mandarla vacía, y te-api se apoya en esa diferencia: sin la clave cae
   * al nombre de su cliente OAuth, que es el comportamiento de un Logto anterior a este campo.
   */
  it('sin RP resuelta no inventa la clave', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ txnId: 'txn-1', expiresAt: 'ya' }));

    await new TeApiClient(config).crearTransaccion(url, { ip: '203.0.113.7' }, 'vlad@example.test');

    expect(Object.keys(cuerpoEnviado(0))).not.toContain('rp');
  });
});

describe('el opt-in del selector cruza hasta te-api', () => {
  it('manda `eager` cuando el tenant lo ha encendido', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ devices: [] }));

    await new TeApiClient(config).listarDispositivos('txn-1', 'reto-1', true);

    expect(cuerpoEnviado(0)).toEqual({ txnId: 'txn-1', challengeId: 'reto-1', eager: true });
  });

  it('y no lo manda por defecto: el selector se gana, no se pide', async () => {
    fetchSimulado.mockResolvedValue(respuestaJson({ devices: [] }));

    await new TeApiClient(config).listarDispositivos('txn-1', 'reto-1');

    expect(cuerpoEnviado(0)).toEqual({ txnId: 'txn-1', challengeId: 'reto-1' });
  });
});
