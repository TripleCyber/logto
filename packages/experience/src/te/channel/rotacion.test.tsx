/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { waitFor } from '@testing-library/react';
import { HTTPError } from 'ky';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import TeSignInAside from './TeSignInAside';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */

/**
 * **Quien rota el código es la pantalla.**
 *
 * Este archivo existe por un fallo que sólo se veía dejando la pantalla de acceso quieta: a los
 * treinta segundos el código desaparecía y salía «este código no está listo», sin que nadie
 * hubiera tocado nada. La causa no estaba en el mensaje sino más abajo — nadie pedía nunca el
 * código siguiente. te-api acuña uno al abrir la sesión y ninguno más por su cuenta: `…/state`
 * deriva el marco de la fila activa, y cuando esa fila caduca no hay marco que derivar y contesta
 * un 4xx. Su propio módulo de rotación lo da por supuesto al enumerar quién compite por el
 * bloqueo: «el temporizador de la pantalla en `displayExpiresAt − 2 s`».
 *
 * Se simula el borde —`./api`, lo único que habla con el servidor— y se comprueban las tres cosas
 * que la persona nota: que el código se renueva solo, que una renovación que falla no pinta nada,
 * y que un sondeo caído sin escaneo intenta acuñar otro código antes de rendirse.
 */
const leerConfigCanal = jest.fn();
const abrirCanalQr = jest.fn();
const sondear = jest.fn();
const rotarCodigo = jest.fn();

jest.mock('./api', () => ({
  get leerConfigCanal() {
    return leerConfigCanal;
  },
  get abrirCanalQr() {
    return abrirCanalQr;
  },
  get sondear() {
    return sondear;
  },
  get rotarCodigo() {
    return rotarCodigo;
  },
  confirmarCanal: jest.fn(),
  abrirCanalPush: jest.fn(),
  despacharPush: jest.fn(),
  listarDispositivos: jest.fn(),
}));

jest.mock('@/apis/experience', () => ({
  identifyAndSubmitInteraction: jest.fn().mockResolvedValue({ redirectTo: 'https://example.com' }),
}));

const conectorTe = {
  id: 'te-connector-id',
  target: objetivoConectorTe,
  platform: ConnectorPlatform.Web,
  type: ConnectorType.Social,
  logo: 'https://example.com/te.png',
  logoDark: null,
  name: { en: 'Sign in with TripleEnable' },
  description: { en: 'Sign in with TripleEnable' },
  readme: '',
  configTemplate: '',
};

const render = () =>
  renderWithPageContext(
    <PageContext.Provider
      value={
        {
          platform: 'web',
          theme: 'light',
          toast: '',
          loading: false,
          termsAgreement: false,
          isPreview: false,
          experienceSettings: {
            ...mockSignInExperienceSettings,
            socialConnectors: [conectorTe] as typeof mockSignInExperienceSettings.socialConnectors,
          },
          setTheme: jest.fn(),
          setToast: jest.fn(),
          setLoading: jest.fn(),
          setPlatform: jest.fn(),
          setTermsAgreement: jest.fn(),
          setExperienceSettings: jest.fn(),
        } as unknown as React.ContextType<typeof PageContext>
      }
    >
      <UserInteractionContextProvider>
        <TeSignInAside />
      </UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: ['/sign-in'] }
  );

/** Ver `signin-split.test.tsx`: jsdom no trae `Response`, y lo único que se mira es el prototipo. */
const errorHttp = (): Error => Object.create(HTTPError.prototype) as Error;

/**
 * Un código de la vida real dura 30 s; aquí `vidaMs` es corta a propósito.
 *
 * El temporizador de la rotación se arma en `displayExpiresAt − 2 s`, así que un código que se
 * pinta durante dos segundos se renueva **inmediatamente**: es la misma aritmética de producción,
 * sin relojes falsos y sin dos segundos de test por cada vuelta.
 */
const codigo = (seq: number, vidaMs = 2000) => ({
  codeId: `c${seq}`,
  uri: `te://requests/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f${seq}`,
  seq,
  displayExpiresAt: new Date(Date.now() + vidaMs).toISOString(),
  hardExpiresAt: new Date(Date.now() + vidaMs + 15_000).toISOString(),
});

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
  leerConfigCanal.mockResolvedValue({ channels: { qr: true, push: true }, devicePicker: 'lazy' });
  abrirCanalQr.mockResolvedValue({
    verificationId: 'v1',
    sessionId: 's1',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    code: codigo(1),
  });
  // `retryAfterMs: 0` es la señal de PARAR: el sondeo da una vuelta y se detiene, así que lo que
  // ocurra después es obra del temporizador de la rotación y de nada más.
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
});

/**
 * Una promesa que se cumple desde fuera: es lo que deja tener DOS rotaciones a la vez, con la
 * primera todavía en vuelo cuando llega la segunda.
 */
const diferido = () => {
  const caja: { cumplir?: (valor: unknown) => void } = {};
  const promesa = new Promise((resolve) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    caja.cumplir = resolve;
  });

  return { promesa, cumplir: (valor: unknown) => caja.cumplir?.(valor) };
};

/** Deja correr los temporizadores ya vencidos y las promesas que cuelgan de ellos. */
const dejarPasar = async (ms = 30) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('el código se renueva solo', () => {
  it('pide el siguiente antes de que el suyo deje de pintarse, con el verifier por cabecera', async () => {
    rotarCodigo.mockResolvedValue(codigo(2, 30_000));

    render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalledTimes(1);
    });

    const [verifier] = rotarCodigo.mock.calls[0] as [string];

    // El verifier no sale de la pestaña más que por esta cabecera: 32 bytes en base64url.
    expect(verifier).toMatch(/^[\w-]{43}$/);
  });

  /*
   * La prueba de que el código nuevo se PINTA, sin mirar dentro del lienzo: el temporizador cuelga
   * del código que se está enseñando, así que sólo se re-arma si el estado cambió. Dos rotaciones
   * seguidas con dos códigos de vida corta son la cadena entera funcionando.
   */
  it('y con el nuevo pintado vuelve a armarse: la renovación es una cadena, no un disparo', async () => {
    rotarCodigo.mockResolvedValueOnce(codigo(2)).mockResolvedValueOnce(codigo(3, 30_000));

    render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalledTimes(2);
    });
  });

  it('un código que no encaja en la forma esperada no se pinta ni rearma nada', async () => {
    // Lo que llega de la red se analiza igual que un marco: `seq` no es un número y el resto
    // sobra. Si esto se pintara, la cuenta atrás quedaría con una fecha inventada.
    rotarCodigo.mockResolvedValue({ codeId: 'c2', uri: 'te://x', seq: 'dos' });

    const { findByText, queryByText } = render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalledTimes(1);
    });
    await dejarPasar();

    expect(rotarCodigo).toHaveBeenCalledTimes(1);
    // Y sobre todo: no se pinta ningún fallo. El código de pantalla sigue en su gracia.
    await expect(findByText('te.status.waiting')).resolves.not.toBeNull();
    expect(queryByText('te.status.unavailable')).toBeNull();
  });

  it('una renovación que se cae no le cuenta nada a nadie: quien dice la verdad es el sondeo', async () => {
    rotarCodigo.mockRejectedValue(errorHttp());

    const { findByText, queryByText } = render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalled();
    });

    await expect(findByText('te.status.waiting')).resolves.not.toBeNull();
    expect(queryByText('te.status.unavailable')).toBeNull();
    expect(queryByText('te.status.failed')).toBeNull();
    expect(queryByText('te.action.retry')).toBeNull();
  });
});

describe('el sondeo que se cae sin escaneo intenta acuñar otro código antes de rendirse', () => {
  it('si el canal sigue vivo, la pantalla se recupera y no dice nada', async () => {
    // El caso de la pestaña en segundo plano: los temporizadores se frenan, la rotación llega
    // tarde, el código muere del todo y `…/state` se queda sin marco que derivar. La sesión, que
    // dura diez veces más que un código, sigue estando ahí.
    abrirCanalQr.mockResolvedValue({
      verificationId: 'v1',
      sessionId: 's1',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      code: codigo(1, 30_000),
    });
    sondear.mockRejectedValue(errorHttp());
    rotarCodigo.mockResolvedValue(codigo(2, 30_000));

    const { findByText, queryByText } = render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalledTimes(1);
    });

    await expect(findByText('te.status.waiting')).resolves.not.toBeNull();
    expect(queryByText('te.status.unavailable')).toBeNull();
  });

  it('y si tampoco se puede acuñar, entonces sí: el código no sirve y se dice con salida', async () => {
    abrirCanalQr.mockResolvedValue({
      verificationId: 'v1',
      sessionId: 's1',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      code: codigo(1, 30_000),
    });
    sondear.mockRejectedValue(errorHttp());
    rotarCodigo.mockRejectedValue(errorHttp());

    const { findByText, queryByText } = render();

    await expect(findByText('te.status.unavailable')).resolves.not.toBeNull();
    // Sigue sin ser un fallo de acceso: nadie escaneó nada.
    expect(queryByText('te.status.failed')).toBeNull();
    await expect(findByText('te.action.retry')).resolves.not.toBeNull();
  });

  /*
   * El peor momento: al volver de una pestaña congelada, el temporizador de la cuenta atrás y la
   * recuperación del sondeo piden código a la vez. te-api rechaza la segunda por su antirráfaga, y
   * ese rechazo, llegándole a la recuperación, pintaría un fallo sobre un canal que acababa de
   * renovarse. Por eso la llamada en vuelo se comparte.
   */
  it('dos rotaciones a la vez son UNA sola petición, y las dos ven el mismo resultado', async () => {
    const pendiente = diferido();

    rotarCodigo.mockReturnValue(pendiente.promesa);
    // El sondeo se cae (llama a la recuperación) y el código dura dos segundos (dispara el
    // temporizador): las dos puertas, abiertas a la vez.
    sondear.mockRejectedValue(errorHttp());

    const { findByText, queryByText } = render();

    await waitFor(() => {
      expect(rotarCodigo).toHaveBeenCalled();
    });
    await dejarPasar(50);

    expect(rotarCodigo).toHaveBeenCalledTimes(1);

    pendiente.cumplir(codigo(2, 30_000));

    await expect(findByText('te.status.waiting')).resolves.not.toBeNull();
    expect(queryByText('te.status.unavailable')).toBeNull();
  });

  it('DESPUÉS de un escaneo no se acuña nada: cambiar el código desemparejaría las dos pantallas', async () => {
    abrirCanalQr.mockResolvedValue({
      verificationId: 'v1',
      sessionId: 's1',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      code: codigo(1, 30_000),
    });
    sondear
      .mockResolvedValueOnce({
        frame: { t: 'claimed', seq: 1 },
        retryAfterMs: 1,
        cabeceraDate: undefined,
      })
      .mockRejectedValue(errorHttp());

    const { findByText } = render();

    // Con escaneo previo sí hubo un intento, así que el fallo se cuenta como fallo del acceso.
    await expect(findByText('te.status.failed')).resolves.not.toBeNull();
    expect(rotarCodigo).not.toHaveBeenCalled();
  });
});

/* eslint-enable */
