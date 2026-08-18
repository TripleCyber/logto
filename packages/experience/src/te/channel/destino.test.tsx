/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { fireEvent } from '@testing-library/react';

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
 * A dónde fue el aviso: lo que la pantalla de espera del push dice del destino.
 *
 * Lo que se comprueba aquí es **qué información sale y cuándo**, igual que en `push.test.tsx`. La
 * pregunta que estos tests contestan no es «¿se pinta bonito?» sino «¿puede esta línea decir algo
 * que el enmascarado no permita, o algo que distinga una cuenta que existe de una que no?».
 *
 * El simulacro está en el borde —el módulo `./api`—, así que lo que se prueba es la pantalla con
 * su hook de verdad: si mañana alguien mueve el campo de sitio dentro del canal, estos tests
 * siguen valiendo; si cambia lo que la persona ve, se rompen.
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

const reto = {
  challengeId: 'r1',
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  matchDigits: '47',
};

/** Una vuelta del sondeo, con o sin etiqueta de destino. */
const vuelta = (frame: unknown, despacho?: unknown) => ({
  frame,
  retryAfterMs: 0,
  cabeceraDate: undefined,
  ...(despacho === undefined ? {} : { despacho }),
});

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
  sondear.mockResolvedValue(vuelta({ t: 'code' }));
  listarDispositivos.mockResolvedValue({
    devices: [{ deviceRef: 'a', kind: 'tablet', lastSeen: 'this_week' }],
  });
});

afterEach(() => {
  sessionStorage.clear();
});

describe('mientras no se sabe a dónde fue', () => {
  it('dice que se está enviando, que durante unos segundos es la verdad', async () => {
    // El servidor resuelve el identificador en un trabajador de fondo, fuera del ciclo de
    // petición, para que la latencia no diga si la cuenta existe (PU-4). Cuando esta pantalla
    // aparece **todavía no ha salido nada**, y decir «lo hemos enviado a tu teléfono» ahí sería
    // mentira además de una diferencia medible.
    const { findByText, queryByText } = render();

    await expect(findByText('te.push.sending')).resolves.not.toBeNull();
    expect(queryByText('te.push.sent_phone')).toBeNull();
    expect(queryByText('te.push.sent_many')).toBeNull();
  });
});

describe('un solo destino', () => {
  it('dice la categoría y la cubeta temporal, que es lo que la lista ya enseña', async () => {
    sondear.mockResolvedValue(
      vuelta({ t: 'code' }, { count: 1, kind: 'phone', lastSeen: 'today' })
    );

    const { findByText, queryByText } = render();

    await expect(findByText('te.push.sent_phone')).resolves.not.toBeNull();
    expect(queryByText('te.push.sending')).toBeNull();
  });

  it('la categoría manda sobre la frase: una tableta no dice «teléfono»', async () => {
    sondear.mockResolvedValue(
      vuelta({ t: 'code' }, { count: 1, kind: 'tablet', lastSeen: 'older' })
    );

    const { findByText, queryByText } = render();

    await expect(findByText('te.push.sent_tablet')).resolves.not.toBeNull();
    expect(queryByText('te.push.sent_phone')).toBeNull();
  });
});

describe('con abanico', () => {
  it('dice cuántos y no enumera', async () => {
    // PU-11: sin dispositivo dirigido el aviso va a todos los elegibles. Ni categoría ni
    // antigüedad: describirían un aparato de una lista, y esa lista es lo que PU-12 no entrega.
    sondear.mockResolvedValue(vuelta({ t: 'code' }, { count: 3 }));

    const { findByText, queryByText } = render();

    await expect(findByText('te.push.sent_many')).resolves.not.toBeNull();
    expect(queryByText('te.push.sent_phone')).toBeNull();
    expect(queryByText('te.push.sent_tablet')).toBeNull();
    expect(queryByText('te.push.sent_desktop')).toBeNull();
  });

  it('un número con categoría pegada sigue diciendo sólo el número', async () => {
    // La segunda cerradura. te-api ya no manda la categoría con abanico; si un día la mandara,
    // la pantalla no puede empezar a decir «tienes 3, y el más reciente es un teléfono».
    sondear.mockResolvedValue(
      vuelta({ t: 'code' }, { count: 2, kind: 'phone', lastSeen: 'today' })
    );

    const { findByText, queryByText } = render();

    await expect(findByText('te.push.sent_many')).resolves.not.toBeNull();
    expect(queryByText('te.push.sent_phone')).toBeNull();
  });
});

describe('lo que esta línea NO puede enseñar', () => {
  it('el nombre que puso la persona no se pinta aunque venga en el cuerpo', async () => {
    sondear.mockResolvedValue(
      vuelta(
        { t: 'code' },
        {
          count: 1,
          kind: 'phone',
          lastSeen: 'today',
          label: 'iPhone de Ana',
          model: 'iPhone 15 Pro',
        }
      )
    );

    const { findByText, container } = render();

    await findByText('te.push.sent_phone');
    // Ese nombre se puede enseñar DESPUÉS de aprobar. Antes, quien mira esta pantalla es sólo
    // quien tecleó un identificador, y no hay ninguna prueba de que sea su dueño.
    expect(container.textContent).not.toContain('Ana');
    expect(container.textContent).not.toContain('iPhone');
  });

  it('la misma etiqueta da la misma pantalla, venga de donde venga', async () => {
    // La pantalla del señuelo. te-api fabrica su etiqueta con un HMAC del identificador y la
    // manda por el mismo campo; aquí no hay —y no puede haber— ninguna rama que mire de dónde
    // viene. Este test fija esa propiedad: dos cuerpos iguales, dos pantallas iguales.
    const etiqueta = { count: 1, kind: 'phone', lastSeen: 'today' };

    sondear.mockResolvedValue(vuelta({ t: 'code' }, etiqueta));
    const primera = render();
    await primera.findByText('te.push.sent_phone');
    const textoReal = primera.container.textContent;
    primera.unmount();

    sondear.mockResolvedValue(vuelta({ t: 'code' }, { ...etiqueta }));
    const segunda = render();
    await segunda.findByText('te.push.sent_phone');

    expect(segunda.container.textContent).toBe(textoReal);
  });
});

describe('cuando el reto muere', () => {
  it('la línea desaparece: ya no queda ningún aviso esperando en ningún móvil', async () => {
    sondear.mockResolvedValue(
      vuelta({ t: 'expired' }, { count: 1, kind: 'phone', lastSeen: 'today' })
    );

    const { findByText, queryByText } = render();

    // Seguir diciendo «enviado a tu teléfono» con el reto caducado manda a mirar un móvil donde
    // no hay nada que aprobar.
    await findByText('te.push.another_device');
    expect(queryByText('te.push.sent_phone')).toBeNull();
    expect(queryByText('te.push.sending')).toBeNull();
  });
});

describe('un despacho nuevo estrena destino', () => {
  it('elegir otro dispositivo cambia lo que dice la línea', async () => {
    sondear.mockResolvedValueOnce(
      vuelta({ t: 'expired' }, { count: 1, kind: 'phone', lastSeen: 'today' })
    );
    sondear.mockResolvedValue(
      vuelta({ t: 'code' }, { count: 1, kind: 'tablet', lastSeen: 'this_week' })
    );

    const { findByText, queryByText } = render();

    fireEvent.click(await findByText('te.push.another_device'));
    await findByText('te.push.devices_description');
    fireEvent.click(await findByText('te.push.device_option'));

    // Arrastrar la etiqueta del reto anterior diría el dispositivo equivocado justo después de
    // que la persona haya elegido otro, que es el peor momento posible para decirlo.
    await expect(findByText('te.push.sent_tablet')).resolves.not.toBeNull();
    expect(queryByText('te.push.sent_phone')).toBeNull();
  });
});

/* eslint-enable */
