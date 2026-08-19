import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { waitFor } from '@testing-library/react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import TePushMfaCard from './TePushMfaCard';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/**
 * LOGTO PATCH(te-push-as-mfa): «aprobar en el teléfono» en la pantalla de segundo factor.
 *
 * Lo que se fija aquí es **cuándo aparece y cuándo no**, que es lo único que decide esta tarjeta.
 * Que además VALGA como segundo factor lo decide el servidor, y eso se prueba en
 * `experience-interaction.test.ts` — son dos mitades y cada una se comprueba donde vive.
 */

const leerConfigCanal = jest.fn();

jest.mock('./api', () => ({
  leerConfigCanal: async () => leerConfigCanal(),
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

const render = (socialConnectors: unknown[]) =>
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
            socialConnectors:
              socialConnectors as typeof mockSignInExperienceSettings.socialConnectors,
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
        <TePushMfaCard />
      </UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: ['/mfa-verification'] }
  );

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
});

describe('aprobar en el teléfono, en la pantalla de segundo factor', () => {
  it('aparece con el conector y el canal push encendidos', async () => {
    leerConfigCanal.mockResolvedValue({
      channels: { qr: true, push: true },
      devicePicker: 'lazy',
    });

    const { queryByText } = render([conectorTe]);

    await waitFor(() => {
      expect(queryByText('te.method.push_title')).not.toBeNull();
    });
  });

  it('no aparece con el canal push apagado en te-api', async () => {
    // Los interruptores del servidor mandan: apagar el push allí quita la tarjeta sin desplegar
    // nada aquí. El QR encendido no la trae de vuelta — son canales distintos.
    leerConfigCanal.mockResolvedValue({
      channels: { qr: true, push: false },
      devicePicker: 'lazy',
    });

    const { queryByText } = render([conectorTe]);

    await waitFor(() => {
      expect(leerConfigCanal).toHaveBeenCalled();
    });
    expect(queryByText('te.method.push_title')).toBeNull();
  });

  it('no aparece sin el conector de la cartera en la consola', async () => {
    leerConfigCanal.mockResolvedValue({
      channels: { qr: true, push: true },
      devicePicker: 'lazy',
    });

    const { queryByText } = render([]);

    expect(queryByText('te.method.push_title')).toBeNull();
  });
});
