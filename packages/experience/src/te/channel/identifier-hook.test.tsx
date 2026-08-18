/*
 * Jsdom no trae `crypto.subtle`; el navegador sí.
 */

import { webcrypto } from 'node:crypto';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { SignInIdentifier } from '@logto/schemas';
import { act, waitFor } from '@testing-library/react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';
import useOnSubmit from '@/components/IdentifierSignInForm/use-on-submit';

import { objetivoConectorTe } from './config';
import useTeAvailability, { olvidarConfigCanal } from './use-te-availability';

// eslint-disable-next-line @silverhand/fp/no-mutating-methods
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });

/**
 * C2 · el enganche en sí: qué pasa **en el momento** en que la persona teclea el identificador.
 *
 * Es la bisagra del criterio y por eso tiene su propio archivo: lo que se comprueba es el orden
 * —SSO gana, después la elección, y passkey no se dispara si vamos a ofrecer elección— y no lo
 * que se pinta después.
 */
const navigate = jest.fn();
const startPasskeyProcessing = jest.fn();
const leerConfigCanal = jest.fn();

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => navigate,
}));

jest.mock('@/hooks/use-start-identifier-passkey-sign-in-processing', () => ({
  __esModule: true,
  default: () => ({ startProcessing: startPasskeyProcessing, isProcessing: false }),
}));

jest.mock('./api', () => ({
  get leerConfigCanal() {
    return leerConfigCanal;
  },
  abrirCanalQr: jest.fn(),
  abrirCanalPush: jest.fn(),
  confirmarCanal: jest.fn(),
  despacharPush: jest.fn(),
  listarDispositivos: jest.fn(),
  rotarCodigo: jest.fn(),
  sondear: jest.fn(),
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

const metodos = [{ identifier: SignInIdentifier.Email, password: true, verificationCode: true }];

/**
 * Arnés mínimo: monta el hook y expone su `onSubmit`.
 *
 * Publica además si el canal ya está resuelto, y el test espera a eso antes de disparar. Sin esa
 * espera se dispararía la versión del `onSubmit` del primer render —cuando la respuesta del
 * servidor todavía no había llegado— y el test mediría el camino de upstream creyendo que mide
 * el nuestro.
 */
const Arnes = ({
  alMontar,
}: {
  readonly alMontar: (enviar: typeof disparar, resuelto: boolean) => void;
}) => {
  const { onSubmit } = useOnSubmit(metodos as never);
  const { resuelto } = useTeAvailability();

  alMontar(onSubmit, resuelto);

  return null;
};

// eslint-disable-next-line @silverhand/fp/no-let
let disparar: (identificador: SignInIdentifier, valor: string) => Promise<void>;
// eslint-disable-next-line @silverhand/fp/no-let
let canalResuelto = false;

const render = ({ connectors }: { connectors: unknown[] }) =>
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
            passkeySignIn: { enabled: true, showPasskeyButton: false },
            // Sin conector SSO: SSO es terminal y gana siempre, así que con uno puesto este
            // enganche no llegaría a ejecutarse y el test no probaría nada.
            ssoConnectors: [],
            socialConnectors: connectors as typeof mockSignInExperienceSettings.socialConnectors,
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
        <Arnes
          alMontar={(enviar, resuelto) => {
            // eslint-disable-next-line @silverhand/fp/no-mutation
            disparar = enviar;
            // eslint-disable-next-line @silverhand/fp/no-mutation
            canalResuelto = resuelto;
          }}
        />
      </UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: ['/sign-in'] }
  );

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
  sessionStorage.clear();
  // eslint-disable-next-line @silverhand/fp/no-mutation
  canalResuelto = false;
  leerConfigCanal.mockResolvedValue({ channels: { qr: true, push: true }, devicePicker: 'lazy' });
});

describe('C2 · el enganche tras el identificador', () => {
  it('con TripleEnable disponible, lleva a la pantalla de métodos', async () => {
    render({ connectors: [conectorTe] });

    await waitFor(() => {
      expect(canalResuelto).toBe(true);
    });

    await act(async () => {
      await disparar(SignInIdentifier.Email, 'ana@example.com');
    });

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/sign-in/verification-methods' }),
      undefined
    );
  });

  it('y NO dispara la llamada de passkey, que es la que filtra el único bit de la línea base', async () => {
    render({ connectors: [conectorTe] });

    await waitFor(() => {
      expect(canalResuelto).toBe(true);
    });

    await act(async () => {
      await disparar(SignInIdentifier.Email, 'ana@example.com');
    });

    expect(startPasskeyProcessing).not.toHaveBeenCalled();
  });

  it('sin el conector, el camino de upstream sigue exactamente igual', async () => {
    startPasskeyProcessing.mockResolvedValue(false);

    render({ connectors: [] });

    await act(async () => {
      await disparar(SignInIdentifier.Email, 'ana@example.com');
    });

    expect(startPasskeyProcessing).toHaveBeenCalledWith({
      type: SignInIdentifier.Email,
      value: 'ana@example.com',
    });
    expect(navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/sign-in/verification-methods' }),
      undefined
    );
  });

  it('el identificador queda guardado antes de decidir nada, como hace upstream', async () => {
    render({ connectors: [conectorTe] });

    await waitFor(() => {
      expect(canalResuelto).toBe(true);
    });

    await act(async () => {
      await disparar(SignInIdentifier.Email, 'ana@example.com');
    });

    await waitFor(() => {
      expect(
        sessionStorage.getItem(`logto:${window.location.origin}:identifier-input-value`)
      ).toContain('ana@example.com');
    });
  });
});
