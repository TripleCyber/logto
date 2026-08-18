/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { fireEvent, waitFor } from '@testing-library/react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import TePushPage from './TePushPage';
import { objetivoConectorTe } from './config';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */

/**
 * C3 · la selección de dispositivo, con la mitigación de PU-12 dentro.
 *
 * Lo que se comprueba aquí no es que la pantalla «funcione», sino **qué información sale y
 * cuándo**. Por eso varias aserciones son sobre las CLAVES de lo que se pide y sobre el texto
 * exacto que se pinta, y no sobre valores: un campo nuevo que se colara desde el servidor tiene
 * que romper un test, no aparecer en la pantalla de acceso.
 */
const leerConfigCanal = jest.fn();
const abrirCanalPush = jest.fn();
const despacharPush = jest.fn();
const listarDispositivos = jest.fn();
const sondear = jest.fn();

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
  get sondear() {
    return sondear;
  },
  abrirCanalQr: jest.fn(),
  confirmarCanal: jest.fn(),
  rotarCodigo: jest.fn(),
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
        <TePushPage />
      </UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: ['/sign-in/te-push'] }
  );

/** Deja que el reto caduque: es lo único que abre la lista de dispositivos (PU-12). */
const retoQueCaduca = () => {
  sondear.mockResolvedValue({ frame: { t: 'expired' }, retryAfterMs: 0, cabeceraDate: undefined });
};

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
  leerConfigCanal.mockResolvedValue({
    channels: { qr: true, push: true },
    devicePicker: 'lazy',
  });
  abrirCanalPush.mockResolvedValue({ verificationId: 'v1' });
  despacharPush.mockResolvedValue(reto);
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
  listarDispositivos.mockResolvedValue({
    devices: [
      { deviceRef: 'a', kind: 'phone', lastSeen: 'today' },
      { deviceRef: 'b', kind: 'tablet', lastSeen: 'this_week' },
    ],
  });
});

afterEach(() => {
  sessionStorage.clear();
});

describe('paso 1 · por defecto se despacha al más reciente sin enseñar lista', () => {
  it('el primer despacho va SIN `deviceRef`', async () => {
    render();

    await waitFor(() => {
      expect(despacharPush).toHaveBeenCalledTimes(1);
    });
    expect(despacharPush).toHaveBeenCalledWith(undefined);
  });

  it('no se pide la lista de dispositivos, ni siquiera de fondo', async () => {
    render();

    await waitFor(() => {
      expect(despacharPush).toHaveBeenCalled();
    });
    expect(listarDispositivos).not.toHaveBeenCalled();
  });

  it('el identificador va en el cuerpo de la apertura, no en un query', async () => {
    render();

    await waitFor(() => {
      expect(abrirCanalPush).toHaveBeenCalledWith('ana@example.com');
    });
  });

  it('no hay botón de «usar otro dispositivo» antes de que nada falle', async () => {
    const { queryByText } = render();

    await waitFor(() => {
      expect(despacharPush).toHaveBeenCalled();
    });
    expect(queryByText('te.push.another_device')).toBeNull();
  });
});

describe('los dos dígitos (PU-1 y PU-9)', () => {
  it('se enseñan en la pantalla, que es lo que obliga a mirar aquí y no sólo el móvil', async () => {
    const { findByText } = render();

    await expect(findByText('47')).resolves.not.toBeNull();
    await expect(findByText('te.push.match_label')).resolves.not.toBeNull();
  });

  it('no se ofrecen tres botones que elegir: 1/100 no es 1/3', async () => {
    const { container } = render();

    await waitFor(() => {
      expect(despacharPush).toHaveBeenCalled();
    });

    // Los únicos controles de la pantalla son los enlaces de salida; no hay una rejilla de
    // números entre los que acertar a ciegas bajo una lluvia de avisos.
    const numeros = [...container.querySelectorAll('button')].filter((boton) =>
      /^\d+$/.test(boton.textContent ?? '')
    );

    expect(numeros).toHaveLength(0);
  });
});

describe('paso 2 · la lista sólo se abre tras un reto que ha fallado', () => {
  it('un reto caducado desbloquea «usar otro dispositivo»', async () => {
    retoQueCaduca();

    const { findByText } = render();

    await expect(findByText('te.push.another_device')).resolves.not.toBeNull();
  });

  it('la lista no se pide hasta que la persona la pide: no basta con que algo falle', async () => {
    retoQueCaduca();

    const { findByText } = render();

    await findByText('te.push.another_device');
    expect(listarDispositivos).not.toHaveBeenCalled();
  });

  it('al pedirla, se pinta enmascarada: categoría y cubeta temporal, nada más', async () => {
    retoQueCaduca();

    const { findByText, getAllByText } = render();

    fireEvent.click(await findByText('te.push.another_device'));

    await expect(findByText('te.push.devices_description')).resolves.not.toBeNull();
    expect(listarDispositivos).toHaveBeenCalledTimes(1);
    // Cada fila lleva la misma etiqueta compuesta y nada más: categoría y cubeta temporal.
    expect(getAllByText('te.push.device_option')).toHaveLength(2);
  });

  it('elegir un dispositivo despacha con su `deviceRef` opaco', async () => {
    retoQueCaduca();

    const { findByText, container } = render();

    fireEvent.click(await findByText('te.push.another_device'));
    await findByText('te.push.devices_description');

    const filas = container.querySelectorAll('button');
    fireEvent.click(filas[0]!);

    await waitFor(() => {
      expect(despacharPush).toHaveBeenLastCalledWith('a');
    });
  });
});

describe('lo que la lista NO enseña', () => {
  it('un nombre puesto por el usuario o un modelo no llegan a la pantalla aunque el servidor los mande', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    listarDispositivos.mockResolvedValue({
      devices: [
        {
          deviceRef: 'a',
          kind: 'phone',
          lastSeen: 'today',
          // Campos que el servidor no debe mandar y que, si los mandara, no pueden pintarse.
          name: 'iPhone de Ana',
          model: 'iPhone 15 Pro',
          lastSeenAt: '2026-08-15T09:58:00.000Z',
        },
      ],
    });

    const { findByText, container } = render();

    fireEvent.click(await findByText('te.push.another_device'));
    await findByText('te.push.devices_description');

    const texto = container.textContent ?? '';

    expect(texto).not.toContain('iPhone de Ana');
    expect(texto).not.toContain('iPhone 15 Pro');
    expect(texto).not.toContain('2026-08-15');
  });

  it('no reordena ni deduplica: taparía un fallo del servidor desde el cliente', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    listarDispositivos.mockResolvedValue({
      devices: [
        { deviceRef: 'z', kind: 'desktop', lastSeen: 'older' },
        { deviceRef: 'a', kind: 'phone', lastSeen: 'today' },
        { deviceRef: 'a2', kind: 'phone', lastSeen: 'today' },
      ],
    });

    const { findByText, container } = render();

    fireEvent.click(await findByText('te.push.another_device'));
    await findByText('te.push.devices_description');

    const filas = [...container.querySelectorAll('button')];

    // Tres filas, en el orden en que llegaron: el orden por más reciente y la ausencia de
    // repetidos son invariantes del servidor, y si se rompen tienen que verse.
    expect(filas).toHaveLength(3);
    fireEvent.click(filas[0]!);
    await waitFor(() => {
      expect(despacharPush).toHaveBeenLastCalledWith('z');
    });
  });

  it('nunca más de cinco: por encima de eso el número deja de ayudar y pasa a ser un censo', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    listarDispositivos.mockResolvedValue({
      devices: Array.from({ length: 9 }, (_, index) => ({
        deviceRef: `d${index}`,
        kind: 'phone',
        lastSeen: 'older',
      })),
    });

    const { findByText, container } = render();

    fireEvent.click(await findByText('te.push.another_device'));
    await findByText('te.push.devices_description');

    expect(container.querySelectorAll('button')).toHaveLength(5);
  });

  it('si la lista falla, el mensaje es el uniforme: nunca «esta cuenta no tiene dispositivos»', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });
    listarDispositivos.mockRejectedValue(new Error('canal no disponible'));

    const { findByText, findAllByText } = render();

    fireEvent.click(await findByText('te.push.another_device'));

    await expect(findAllByText('te.status.failed')).resolves.not.toHaveLength(0);
  });
});

describe('el opt-in del tenant', () => {
  it('con `eager` la lista se abre sin gastar ningún push, que es su coste', async () => {
    leerConfigCanal.mockResolvedValue({
      channels: { qr: true, push: true },
      devicePicker: 'eager',
    });

    const { findByText } = render();

    await expect(findByText('te.push.another_device')).resolves.not.toBeNull();
  });
});

describe('siempre hay salida', () => {
  it('«usar otro método» está a mano desde el primer momento', async () => {
    // El enlace es el de upstream —`SwitchToVerificationMethodsLink`, el mismo que usan
    // contraseña, código y passkey— y por eso lleva su copia y no una nuestra: la lógica de a
    // dónde lleva tiene que seguir siendo la de Logto y no una copia que mañana se desvíe.
    const { findByText } = render();

    await expect(findByText('mfa.try_another_verification_method')).resolves.not.toBeNull();
  });

  it('sin canal push la pantalla no existe, aunque se escriba la URL a mano', async () => {
    leerConfigCanal.mockResolvedValue({
      channels: { qr: true, push: false },
      devicePicker: 'lazy',
    });

    const { findByText } = render();

    await expect(findByText('error.invalid_session')).resolves.not.toBeNull();
    expect(abrirCanalPush).not.toHaveBeenCalled();
  });

  it('sin identificador tampoco: no hay a quién avisar', async () => {
    sessionStorage.clear();

    const { findByText } = render();

    await expect(findByText('error.invalid_session')).resolves.not.toBeNull();
    expect(despacharPush).not.toHaveBeenCalled();
  });
});

/* eslint-enable */
