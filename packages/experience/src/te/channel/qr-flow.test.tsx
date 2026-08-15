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

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import TeQrPage from './TeQrPage';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */

/**
 * El recorrido del canal QR: qué se pide, en qué orden, y qué se le dice a la persona.
 *
 * La aserción que más importa de este archivo es la de CH-6: un marco `approved` **notifica**, no
 * autoriza. Si `confirm` dice que no, la pantalla tiene que tratarlo como un fallo y no meter a
 * nadie en ningún sitio.
 */
const leerConfigCanal = jest.fn();
const abrirCanalQr = jest.fn();
const sondear = jest.fn();
const confirmarCanal = jest.fn();
const identifyAndSubmitInteraction = jest.fn();

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
  get identifyAndSubmitInteraction() {
    return identifyAndSubmitInteraction;
  },
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
          platform: 'mobile',
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
        <TeQrPage />
      </UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: ['/sign-in/te-qr'] }
  );

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
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
  confirmarCanal.mockResolvedValue({ verificationId: 'v1' });
  identifyAndSubmitInteraction.mockResolvedValue({ redirectTo: 'https://example.com/done' });
});

describe('la apertura del canal', () => {
  it('declara la huella del verifier y nada más: el secreto no sale de esta pestaña', async () => {
    render();

    await waitFor(() => {
      expect(abrirCanalQr).toHaveBeenCalledTimes(1);
    });

    const [channelHash] = abrirCanalQr.mock.calls[0] as [string];

    // 43 caracteres de base64url sin relleno: `sha256` en 32 bytes.
    expect(channelHash).toMatch(/^[\w-]{43}$/);
  });
});

describe('CH-6 · un marco `approved` notifica, no autoriza', () => {
  it('cuando llega, se llama a `confirm` y luego al camino nativo de identificación', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'approved' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    render();

    await waitFor(() => {
      expect(confirmarCanal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(identifyAndSubmitInteraction).toHaveBeenCalledTimes(1);
    });
  });

  it('si `confirm` dice que no, el marco era mentira y no se identifica a nadie', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'approved' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    confirmarCanal.mockRejectedValue(new Error('canal no disponible'));

    const { findByText } = render();

    await expect(findByText('te.status.failed')).resolves.not.toBeNull();
    expect(identifyAndSubmitInteraction).not.toHaveBeenCalled();
  });
});

describe('los estados que la persona tiene que entender', () => {
  it.each([
    ['rejected', 'te.status.rejected'],
    ['expired', 'te.status.expired'],
    ['failed', 'te.status.failed'],
  ])('el marco `%s` se cuenta como «%s», sin jerga y con algo que hacer', async (marco, clave) => {
    sondear.mockResolvedValue({ frame: { t: marco }, retryAfterMs: 0, cabeceraDate: undefined });

    const { findByText } = render();

    await expect(findByText(clave)).resolves.not.toBeNull();
    // Y siempre queda un botón de reintentar: un estado final sin salida es un callejón.
    await expect(findByText('te.action.retry')).resolves.not.toBeNull();
  });

  it('«escaneado» dice que hay que terminar en el móvil', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'claimed', seq: 1 },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByText } = render();

    await expect(findByText('te.status.scanned')).resolves.not.toBeNull();
  });

  it('un corte de red se cuenta como corte de red, no como fallo del acceso', async () => {
    // Un fallo sin respuesta HTTP es la red. De eso sí se vuelve, así que el mensaje no puede ser
    // el mismo que el de un canal que ya no sirve.
    sondear.mockRejectedValue(new TypeError('Failed to fetch'));

    const { findByText } = render();

    await expect(findByText('te.status.offline')).resolves.not.toBeNull();
  });

  it('el mensaje de fallo es el uniforme: no distingue tener cartera de no tenerla', async () => {
    sondear.mockResolvedValue({ frame: { t: 'failed' }, retryAfterMs: 0, cabeceraDate: undefined });

    const { findByText, container } = render();

    await findByText('te.status.failed');

    const texto = container.textContent ?? '';

    expect(texto).not.toMatch(/device|dispositiv|wallet|cartera|cuenta/i);
  });
});

describe('el sondeo', () => {
  it('para cuando el servidor dice `retryAfterMs: 0`', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'code', code: codigo(2) },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    render();

    await waitFor(() => {
      expect(sondear).toHaveBeenCalledTimes(1);
    });

    // Un ritmo de cero es la señal de PARAR, no de sondear sin pausa.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(sondear).toHaveBeenCalledTimes(1);
  });

  it('lleva el verifier por cabecera, y por eso el cliente lo recibe como argumento', async () => {
    render();

    await waitFor(() => {
      expect(sondear).toHaveBeenCalled();
    });

    const [verifier] = sondear.mock.calls[0] as [string];

    expect(typeof verifier).toBe('string');
    expect(verifier).not.toBe('');
  });
});

/* eslint-enable */
