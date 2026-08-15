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
import SocialSignInList from '@/containers/SocialSignInList';
import SignInVerificationMethods from '@/pages/SignInVerificationMethods';

import TeQrInline from './TeQrInline';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */

/**
 * Los criterios del dueño, comprobados uno a uno sobre lo que se pinta.
 *
 * El canal se simula al borde —el módulo `./api`, que es el único que habla con el servidor— y no
 * más adentro. Así los tests fallan si cambia lo que la persona ve o lo que se pide por la red, y
 * no si se reorganiza un componente.
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
  abrirCanalPush: jest.fn(),
  confirmarCanal: jest.fn(),
  despacharPush: jest.fn(),
  listarDispositivos: jest.fn(),
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

const ajustesCon = (connectors: unknown[]) => ({
  ...mockSignInExperienceSettings,
  socialConnectors: connectors as typeof mockSignInExperienceSettings.socialConnectors,
});

/** Es lo que deja `use-on-submit` al teclear el identificador. */
const tecleaIdentificador = () => {
  sessionStorage.setItem(
    `logto:${window.location.origin}:identifier-input-value`,
    JSON.stringify({ type: 'email', value: 'ana@example.com' })
  );
};

const canalEncendido = { channels: { qr: true, push: true }, devicePicker: 'lazy' as const };

/** Monta con la plataforma que se le diga; es lo mismo que hace la vista previa de la consola. */
const render = (
  ui: React.ReactElement,
  {
    platform,
    connectors = [conectorTe],
    ruta = '/sign-in',
  }: { platform: 'web' | 'mobile'; connectors?: unknown[]; ruta?: string }
) =>
  renderWithPageContext(
    <PageContext.Provider
      value={
        {
          platform,
          theme: 'light',
          toast: '',
          loading: false,
          termsAgreement: false,
          isPreview: false,
          experienceSettings: ajustesCon(connectors),
          setTheme: jest.fn(),
          setToast: jest.fn(),
          setLoading: jest.fn(),
          setPlatform: jest.fn(),
          setTermsAgreement: jest.fn(),
          setExperienceSettings: jest.fn(),
        } as unknown as React.ContextType<typeof PageContext>
      }
    >
      <UserInteractionContextProvider>{ui}</UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: [ruta] }
  );

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
  leerConfigCanal.mockResolvedValue(canalEncendido);
  abrirCanalQr.mockResolvedValue({
    verificationId: 'v1',
    sessionId: 's1',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    code: {
      codeId: 'c1',
      uri: 'te://requests/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      seq: 1,
      displayExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      hardExpiresAt: new Date(Date.now() + 45_000).toISOString(),
    },
  });
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
});

describe('C1 · el QR sólo se pinta solo en escritorio', () => {
  it('en escritorio el código aparece directamente en la pantalla de acceso', async () => {
    const { container } = render(<TeQrInline />, { platform: 'web' });

    await waitFor(() => {
      expect(container.querySelector('canvas')).not.toBeNull();
    });
    expect(abrirCanalQr).toHaveBeenCalledTimes(1);
  });

  it('en móvil NO se pinta ahí: un QR en el móvil no se escanea con ese móvil', async () => {
    const { container } = render(<TeQrInline />, { platform: 'mobile' });

    await waitFor(() => {
      expect(leerConfigCanal).toHaveBeenCalled();
    });
    expect(container.querySelector('canvas')).toBeNull();
    expect(abrirCanalQr).not.toHaveBeenCalled();
  });

  it('en móvil se llega por el botón del conector, que lleva a su propia pantalla', async () => {
    const { findByAltText } = render(
      <SocialSignInList socialConnectors={[conectorTe] as never} />,
      {
        platform: 'mobile',
      }
    );

    await expect(findByAltText(objetivoConectorTe)).resolves.not.toBeNull();
  });

  it('en escritorio el botón del conector desaparece: el código ya está pintado arriba', async () => {
    const { queryByAltText } = render(
      <SocialSignInList socialConnectors={[conectorTe] as never} />,
      {
        platform: 'web',
      }
    );

    await waitFor(() => {
      expect(leerConfigCanal).toHaveBeenCalled();
    });
    expect(queryByAltText(objetivoConectorTe)).toBeNull();
  });

  describe('reactividad a consola', () => {
    it('sin el conector en la configuración no hay QR ni botón, y NO se pregunta al servidor', async () => {
      const { container, queryByAltText } = render(
        <>
          <TeQrInline />
          <SocialSignInList socialConnectors={[] as never} />
        </>,
        { platform: 'web', connectors: [] }
      );

      await waitFor(() => {
        expect(container.querySelector('canvas')).toBeNull();
      });
      expect(queryByAltText(objetivoConectorTe)).toBeNull();
      expect(leerConfigCanal).not.toHaveBeenCalled();
    });

    it('con el canal apagado en el servidor tampoco se pinta: fail-closed', async () => {
      leerConfigCanal.mockResolvedValue({
        channels: { qr: false, push: false },
        devicePicker: 'lazy',
      });

      const { container } = render(<TeQrInline />, { platform: 'web' });

      await waitFor(() => {
        expect(leerConfigCanal).toHaveBeenCalled();
      });
      expect(container.querySelector('canvas')).toBeNull();
    });

    it('si el servidor no contesta, el factor no se ofrece en vez de ofrecerse y fallar', async () => {
      leerConfigCanal.mockRejectedValue(new Error('te-api caído'));

      const { container } = render(<TeQrInline />, { platform: 'web' });

      await waitFor(() => {
        expect(leerConfigCanal).toHaveBeenCalled();
      });
      expect(container.querySelector('canvas')).toBeNull();
    });
  });
});

describe('C2 · tras el identificador se ofrecen los dos métodos', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('con identificador, la pantalla de métodos ofrece entrar por QR y por push', async () => {
    tecleaIdentificador();

    const { findByText } = render(<SignInVerificationMethods />, {
      platform: 'web',
      ruta: '/sign-in/verification-methods',
    });

    await expect(findByText('te.method.qr_title')).resolves.not.toBeNull();
    await expect(findByText('te.method.push_title')).resolves.not.toBeNull();
  });

  it('los métodos nativos siguen ahí: las tarjetas de TripleEnable se suman, no sustituyen', async () => {
    tecleaIdentificador();

    const { findByText } = render(<SignInVerificationMethods />, {
      platform: 'web',
      ruta: '/sign-in/verification-methods',
    });

    await expect(findByText('description.verification_method.password')).resolves.not.toBeNull();
  });

  it('con el conector apagado en consola no aparece ninguna de las dos', async () => {
    tecleaIdentificador();

    const { queryByText, findByText } = render(<SignInVerificationMethods />, {
      platform: 'web',
      ruta: '/sign-in/verification-methods',
      connectors: [],
    });

    await expect(findByText('description.verification_method.password')).resolves.not.toBeNull();
    expect(queryByText('te.method.qr_title')).toBeNull();
    expect(queryByText('te.method.push_title')).toBeNull();
  });

  it('no consulta al directorio: nunca se pide nada con el identificador dentro', async () => {
    render(<TeQrInline />, { platform: 'web' });

    await waitFor(() => {
      expect(leerConfigCanal).toHaveBeenCalled();
    });

    // `leerConfigCanal` no recibe argumentos por construcción: no hay forma de preguntar «¿este
    // correo tiene cartera?» sin cambiar el contrato, y este test se rompería si alguien lo hace.
    for (const llamada of leerConfigCanal.mock.calls) {
      expect(llamada).toHaveLength(0);
    }
  });
});

describe('C4 · en crear cuenta no se puede continuar con TripleEnable', () => {
  it('en el alta el botón no se pinta, ni siquiera en móvil', async () => {
    const { queryByAltText } = render(
      <SocialSignInList socialConnectors={[conectorTe] as never} />,
      {
        platform: 'mobile',
        ruta: '/register',
      }
    );

    await waitFor(() => {
      expect(queryByAltText(objetivoConectorTe)).toBeNull();
    });
  });

  it('en el alta ni siquiera se le pregunta al servidor por el canal', async () => {
    render(<SocialSignInList socialConnectors={[conectorTe] as never} />, {
      platform: 'mobile',
      ruta: '/register',
    });

    await waitFor(() => {
      expect(leerConfigCanal).not.toHaveBeenCalled();
    });
  });

  it('los demás conectores sociales del alta siguen intactos', async () => {
    const github = { ...conectorTe, id: 'github-id', target: 'github' };

    const { findByAltText } = render(
      <SocialSignInList socialConnectors={[conectorTe, github] as never} />,
      { platform: 'mobile', ruta: '/register' }
    );

    await expect(findByAltText('github')).resolves.not.toBeNull();
  });
});

describe('el QR de escritorio, por dentro', () => {
  it('pinta el número de emparejamiento, que se deriva aquí y no lo dice el servidor', async () => {
    const { findByText } = render(<TeQrInline />, { platform: 'web' });

    await expect(findByText('te.qr.pair_code_label')).resolves.not.toBeNull();
    // Cuatro cifras con ceros a la izquierda: la comparación que se le pide a una persona es de
    // caracteres, no de aritmética. Se busca el elemento cuyo texto son exactamente cuatro
    // dígitos, no una subcadena suelta del cuerpo.
    await waitFor(() => {
      const cifras = [...document.body.querySelectorAll('div')].filter((elemento) =>
        /^\d{4}$/.test(elemento.textContent ?? '')
      );

      expect(cifras).toHaveLength(1);
    });
  });

  it('ofrece la vía sin cámara, que es la alternativa cuando no se puede escanear', async () => {
    const { findByText } = render(<TeQrInline />, { platform: 'web' });

    await expect(findByText('te.qr.no_camera')).resolves.not.toBeNull();
  });

  it('el lienzo tiene nombre accesible: un `<canvas>` mudo no anuncia nada', async () => {
    const { container } = render(<TeQrInline />, { platform: 'web' });

    await waitFor(() => {
      expect(container.querySelector('canvas')).not.toBeNull();
    });

    const lienzo = container.querySelector('canvas');

    expect(lienzo?.getAttribute('role')).toBe('img');
    expect(lienzo?.getAttribute('aria-label')).toBe('te.qr.alt');
  });
});

/* eslint-enable */
