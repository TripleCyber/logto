/*
 * Jsdom no trae `crypto.subtle` ni `TextEncoder`; el navegador sí.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder -- jsdom no los trae */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { SignInIdentifier } from '@logto/schemas';
import { act, waitFor } from '@testing-library/react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';
import useOnSubmit from '@/components/IdentifierSignInForm/use-on-submit';

import TePushPage from './TePushPage';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */
/* eslint-enable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

/**
 * La costura, probada donde se rompió.
 *
 * Cada caso de este archivo corresponde a un fallo que **sólo apareció al recorrer el flujo
 * entero contra un Logto y un te-api vivos**, y que la suite anterior no podía ver porque cada
 * pieza estaba simulada en su borde y las simulaciones coincidían consigo mismas. Están juntos a
 * propósito: lo que tienen en común no es el componente que tocan, sino que ninguno se cae solo.
 *
 * 1. Abrir el canal sin arrancar la interacción → `404 session.interaction_not_found`.
 * 2. Identificar sin el `verificationId` de `confirm` → `400 guard.invalid_input` con la firma de
 *    la cartera ya hecha.
 * 3. El techo de sesión tapando el marco `expired` → el selector de dispositivos no se abría nunca.
 * 4. Decidir el camino del identificador antes de que los interruptores hubieran contestado.
 */
const leerConfigCanal = jest.fn();
const abrirCanalPush = jest.fn();
const despacharPush = jest.fn();
const listarDispositivos = jest.fn();
const confirmarCanal = jest.fn();
const sondear = jest.fn();
const identifyAndSubmitInteraction = jest.fn();
const navigate = jest.fn();
const startPasskeyProcessing = jest.fn();

jest.mock('./api', () => ({
  get leerConfigCanal() {
    return leerConfigCanal;
  },
  get abrirCanalPush() {
    return abrirCanalPush;
  },
  get despacharPush() {
    return despacharPush;
  },
  get listarDispositivos() {
    return listarDispositivos;
  },
  get confirmarCanal() {
    return confirmarCanal;
  },
  get sondear() {
    return sondear;
  },
  abrirCanalQr: jest.fn(),
  rotarCodigo: jest.fn(),
}));

jest.mock('@/apis/experience', () => ({
  ...jest.requireActual('@/apis/experience'),
  get identifyAndSubmitInteraction() {
    return identifyAndSubmitInteraction;
  },
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigate,
}));

jest.mock('@/hooks/use-start-identifier-passkey-sign-in-processing', () => ({
  __esModule: true,
  default: () => ({ startProcessing: startPasskeyProcessing, isProcessing: false }),
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

const contexto = (children: React.ReactNode) => (
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
    <UserInteractionContextProvider>{children}</UserInteractionContextProvider>
  </PageContext.Provider>
);

const renderPush = () =>
  renderWithPageContext(contexto(<TePushPage />), { initialEntries: ['/sign-in/te-push'] });

const reto = {
  challengeId: 'r1',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  matchDigits: '47',
};

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
  sessionStorage.setItem(
    `logto:${window.location.origin}:identifier-input-value`,
    JSON.stringify({ type: 'email', value: 'ana@example.com' })
  );
  leerConfigCanal.mockResolvedValue({ channels: { qr: true, push: true }, devicePicker: 'lazy' });
  abrirCanalPush.mockResolvedValue({ verificationId: 'v1' });
  despacharPush.mockResolvedValue(reto);
  confirmarCanal.mockResolvedValue({ verificationId: 'v-confirmada' });
  identifyAndSubmitInteraction.mockResolvedValue({ redirectTo: undefined });
  listarDispositivos.mockResolvedValue({
    devices: [{ deviceRef: 'a', kind: 'phone', lastSeen: 'today' }],
  });
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
});

afterEach(() => {
  sessionStorage.clear();
});

describe('la redención pasa el identificador de la verificación', () => {
  /**
   * `confirm` ya canjeó el `code` y la cartera ya firmó. Identificar con el cuerpo vacío hacía que
   * la ruta respondiera `400 guard.invalid_input` y la pantalla dijera «no se pudo confirmar el
   * acceso» con todo el trabajo hecho. Es lo mismo que hace el callback social de upstream.
   */
  it('llama a identificar con el `verificationId` que devolvió `confirm`', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'approved' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    renderPush();

    await waitFor(() => {
      expect(identifyAndSubmitInteraction).toHaveBeenCalledWith({
        verificationId: 'v-confirmada',
      });
    });
  });

  it('si `confirm` dice que no, no se identifica a nadie (CH-6)', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'approved' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    confirmarCanal.mockRejectedValue(new Error('confirm rechazó'));

    renderPush();

    await waitFor(() => {
      expect(confirmarCanal).toHaveBeenCalled();
    });

    expect(identifyAndSubmitInteraction).not.toHaveBeenCalled();
  });
});

describe('el techo de sesión no tapa el marco del servidor', () => {
  /**
   * El techo se calcula desde el mismo `expiresAt` que usa el servidor, así que llegaba siempre un
   * instante antes que el marco `expired` y cortaba el sondeo. Y como el desbloqueo del selector es
   * un **efecto** de ese sondeo (PU-12: se gana habiendo gastado un push real), «usar otro
   * dispositivo» no aparecía nunca por mucho que el reto hubiera fallado de verdad.
   */
  it('con el reto ya caducado, aún sondea una vez y abre el selector', async () => {
    despacharPush.mockResolvedValue({ ...reto, expiresAt: new Date(Date.now() - 1).toISOString() });
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { queryByText } = renderPush();

    await waitFor(() => {
      expect(sondear).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(queryByText('te.push.another_device')).not.toBeNull();
    });
  });
});

/**
 * Una promesa que se resuelve a mano, para poder mirar el estado intermedio: el conector puesto y
 * la respuesta del servidor todavía en vuelo.
 */
const sinDueno = () => {
  throw new Error('promesa sin dueño');
};

const promesaAMano = () => {
  // eslint-disable-next-line @silverhand/fp/no-let
  let resolver: (valor: unknown) => void = sinDueno;

  const promesa = new Promise((resolve) => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    resolver = resolve;
  });

  return {
    promesa,
    contestar: (valor: unknown) => {
      resolver(valor);
    },
  };
};

describe('el camino del identificador no depende de lo rápida que sea la red', () => {
  /**
   * Con el conector configurado pero la respuesta todavía en vuelo, decidir con la bandera a medio
   * resolver mandaba a la pantalla de contraseña. El mismo identificador daba dos caminos según la
   * latencia, y el corto se parecía mucho a «esta cuenta no tiene cartera».
   */
  const Arnes = () => {
    const { onSubmit } = useOnSubmit([
      {
        identifier: SignInIdentifier.Email,
        password: true,
        verificationCode: true,
        isPasswordPrimary: true,
      },
    ]);

    return (
      <button
        type="button"
        onClick={() => {
          void onSubmit(SignInIdentifier.Email, 'ana@example.com');
        }}
      >
        enviar
      </button>
    );
  };

  it('espera a los interruptores si se envía antes de que contesten', async () => {
    const pendiente = promesaAMano();

    leerConfigCanal.mockReturnValue(pendiente.promesa);

    const { getByText } = renderWithPageContext(contexto(<Arnes />), {
      initialEntries: ['/sign-in'],
    });

    await act(async () => {
      getByText('enviar').click();
    });

    // Todavía no ha contestado nadie: no se ha decidido nada.
    expect(navigate).not.toHaveBeenCalled();
    expect(startPasskeyProcessing).not.toHaveBeenCalled();

    await act(async () => {
      pendiente.contestar({ channels: { qr: true, push: true }, devicePicker: 'lazy' });
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/sign-in/verification-methods' }),
        undefined
      );
    });

    expect(startPasskeyProcessing).not.toHaveBeenCalled();
  });
});
