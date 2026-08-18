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
 * La columna del código de la pantalla de acceso: **qué dice en cada estado**.
 *
 * Todo este archivo existe por una queja concreta del dueño: la pantalla pintaba «no se ha
 * confirmado el acceso» sin que nadie hubiera escaneado nada. Esperar no es fallar, y el estado
 * lo manda el canal en vivo y no un temporizador local ni una vuelta del sondeo que se cayó.
 *
 * El canal se simula al borde —el módulo `./api`, que es el único que habla con el servidor— y no
 * más adentro: así los tests se rompen si cambia lo que la persona lee, y no si se reorganiza un
 * componente.
 */
const leerConfigCanal = jest.fn();
const abrirCanalQr = jest.fn();
const sondear = jest.fn();
const confirmarCanal = jest.fn();

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
  get confirmarCanal() {
    return confirmarCanal;
  },
  abrirCanalPush: jest.fn(),
  despacharPush: jest.fn(),
  listarDispositivos: jest.fn(),
  rotarCodigo: jest.fn(),
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

/**
 * Un error HTTP del canal, sin construir la respuesta.
 *
 * Lo que mira el código es `error instanceof HTTPError` —«el servidor contestó, y contestó que
 * no»—, y jsdom no trae `Response` ni `Request`, así que el constructor de verdad no se puede
 * llamar aquí. Encadenar el prototipo dice exactamente lo mismo sin inventarse una respuesta que
 * nadie lee.
 */
const errorHttp = (): Error => Object.create(HTTPError.prototype) as Error;

const codigo = (seq: number) => ({
  codeId: `c${seq}`,
  uri: `te://requests/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f${seq}`,
  seq,
  displayExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  hardExpiresAt: new Date(Date.now() + 45_000).toISOString(),
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
  // `retryAfterMs: 0` es la señal de PARAR: una sola vuelta y el sondeo se detiene.
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
});

describe('la maquetación de la columna', () => {
  it('el título y la nota de la maqueta salen de i18n, no cableados', async () => {
    const { findByText } = render();

    await expect(findByText('te.qr.aside_title')).resolves.not.toBeNull();
    await expect(findByText('te.qr.aside_note')).resolves.not.toBeNull();
  });

  /*
   * El orden en el DOM ES el orden en pantalla: la columna es una caja en columna sin `order` ni
   * `flex-direction: column-reverse`. Taparlo con su propio reloj impediría justo lo que se pide
   * hacer, así que el reloj va después del código y esto lo fija.
   */
  it('la barra de vida y los segundos van DEBAJO del código, nunca encima', async () => {
    const { container, findByText } = render();

    await findByText('te.qr.refresh_in');

    const lienzo = container.querySelector('canvas');
    const segundos = [...container.querySelectorAll('div')].find((elemento) =>
      elemento.textContent?.includes('te.qr.refresh_in')
    );

    expect(lienzo).not.toBeNull();
    expect(segundos).toBeDefined();
    // `DOCUMENT_POSITION_FOLLOWING` = el reloj viene después del código en el orden del documento.
    // eslint-disable-next-line no-bitwise
    expect(lienzo!.compareDocumentPosition(segundos!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
});

/**
 * Un `IntersectionObserver` de mentira que contesta siempre «no está pintado», que es lo que
 * contesta el de verdad ante un `display: none` — la columna por debajo de 820 px. jsdom no trae
 * ninguno, así que sin este doble el hook responde «sí» y este caso no se podría comprobar.
 */
class ObservadorQueDiceQueNo {
  constructor(private readonly avisar: (entradas: unknown[]) => void) {}

  observe() {
    this.avisar([{ isIntersecting: false }]);
  }

  disconnect() {
    // No hay nada que soltar.
  }
}

/* eslint-disable @silverhand/fp/no-mutating-methods -- se instala y se retira un doble global. */
const instalarObservador = (valor: unknown) => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: valor,
    writable: true,
    configurable: true,
  });
};
/* eslint-enable @silverhand/fp/no-mutating-methods */

describe('la columna escondida por CSS no gasta nada', () => {
  afterEach(() => {
    // `undefined` y no `delete`: `useEstaVisible` pregunta por `typeof`, así que da igual, y jsdom
    // tampoco definía la propiedad de serie.
    instalarObservador(undefined);
  });

  it('con la columna escondida NO se abre ningún canal contra te-api', async () => {
    instalarObservador(ObservadorQueDiceQueNo);

    const { findByText } = render();

    // El título sí está —la columna existe en el DOM, la esconde el CSS— pero el canal no.
    await findByText('te.qr.aside_title');
    await waitFor(() => {
      expect(leerConfigCanal).toHaveBeenCalled();
    });
    expect(abrirCanalQr).not.toHaveBeenCalled();
    expect(sondear).not.toHaveBeenCalled();
  });
});

describe('esperar no es fallar', () => {
  it('el estado por defecto es «esperando», y no hay nada que reintentar', async () => {
    const { findByText, queryByText } = render();

    await expect(findByText('te.status.waiting')).resolves.not.toBeNull();
    expect(queryByText('te.status.failed')).toBeNull();
    expect(queryByText('te.action.retry')).toBeNull();
  });

  it('una vuelta del sondeo que se cae SIN escaneo previo no dice que el acceso falló', async () => {
    // Un 4xx del canal: el canal ya no sirve. Nadie ha escaneado, así que no hay acceso que
    // hubiera podido fallar — lo único cierto es que este código no vale y hay que pedir otro.
    sondear.mockRejectedValue(errorHttp());

    const { findByText, queryByText } = render();

    await expect(findByText('te.status.unavailable')).resolves.not.toBeNull();
    expect(queryByText('te.status.failed')).toBeNull();
    // Un estado final sin salida es un callejón: siempre queda el reintento.
    await expect(findByText('te.action.retry')).resolves.not.toBeNull();
  });

  it('un canal que ni siquiera se abre tampoco dice que el acceso falló', async () => {
    abrirCanalQr.mockRejectedValue(errorHttp());

    const { findByText, queryByText } = render();

    await expect(findByText('te.status.unavailable')).resolves.not.toBeNull();
    expect(queryByText('te.status.failed')).toBeNull();
  });

  it('un marco `failed` sin escaneo previo tampoco: el canal murió, nadie intentó nada', async () => {
    sondear.mockResolvedValue({ frame: { t: 'failed' }, retryAfterMs: 0, cabeceraDate: undefined });

    const { findByText, queryByText } = render();

    await expect(findByText('te.status.unavailable')).resolves.not.toBeNull();
    expect(queryByText('te.status.failed')).toBeNull();
  });

  it('DESPUÉS de un escaneo, un fallo sí se cuenta como fallo del acceso', async () => {
    sondear
      .mockResolvedValueOnce({
        frame: { t: 'claimed', seq: 1 },
        retryAfterMs: 1,
        cabeceraDate: undefined,
      })
      .mockResolvedValue({ frame: { t: 'failed' }, retryAfterMs: 0, cabeceraDate: undefined });

    const { findByText } = render();

    await expect(findByText('te.status.failed')).resolves.not.toBeNull();
  });
});

describe('escaneado', () => {
  it('en cuanto el canal dice que reclamaron el código, cambia el texto', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'claimed', seq: 1 },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByText } = render();

    await expect(findByText('te.status.scanned')).resolves.not.toBeNull();
  });

  it('y se para la cuenta atrás: un código ya cogido no anuncia que va a renovarse', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'claimed', seq: 1 },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByText, queryByText } = render();

    await findByText('te.status.scanned');
    expect(queryByText('te.qr.refresh_in')).toBeNull();
  });
});

/* eslint-enable n/prefer-global/text-encoder, n/prefer-global/text-decoder */
