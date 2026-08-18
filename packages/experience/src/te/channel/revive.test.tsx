/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { ConnectorPlatform, ConnectorType } from '@logto/connector-kit';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { HTTPError } from 'ky';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import UserInteractionContextProvider from '@/Providers/UserInteractionContextProvider';
import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import TeQrPage from './TeQrPage';
import TeSignInAside from './TeSignInAside';
import { objetivoConectorTe } from './config';
import { canalMuerto, hayReintento, pideEmpezarDeNuevo } from './superficie';
import { olvidarConfigCanal } from './use-te-availability';

/* eslint-disable @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });
/* eslint-enable @silverhand/fp/no-mutating-methods */

/**
 * **Volver a la vida.** Los cuatro fallos que el dueño vio son el mismo visto desde cuatro sitios,
 * y este archivo los fija a los cuatro:
 *
 *  - **F1** · el canal muere y el último código se queda pintado bajo un velo que es el botón.
 *  - **F2** · entrar a la pantalla de factor acuña un código nuevo, venga de donde venga.
 *  - **F3** · «Reintentar» reabre de verdad; y cuando lo que caducó es el login entero, se dice y
 *    se ofrece empezar de nuevo en vez de un botón que no puede funcionar.
 *  - **F4** · un corte de red al abrir se reabre solo; ninguna pantalla queda esperando un F5.
 *
 * El canal se simula al borde —`./api`, el único módulo que habla con el servidor— para que estos
 * tests se rompan si cambia lo que la persona ve, y no si se reorganiza un componente.
 */
const leerConfigCanal = jest.fn();
const abrirCanalQr = jest.fn();
const sondear = jest.fn();
const rotarCodigo = jest.fn();
const reiniciarAcceso = jest.fn();

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

jest.mock('./reinicio', () => ({
  get reiniciarAcceso() {
    return reiniciarAcceso;
  },
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

const render = (nodo: React.ReactNode, ruta: string) =>
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
      <UserInteractionContextProvider>{nodo}</UserInteractionContextProvider>
    </PageContext.Provider>,
    { initialEntries: [ruta] }
  );

const renderColumna = () => render(<TeSignInAside />, '/sign-in');
const renderPantalla = () => render(<TeQrPage />, '/sign-in/te-qr');

/**
 * Un error HTTP con cuerpo, que es lo que separa «el canal ya no sirve» de «el login se fue».
 *
 * jsdom no trae `Response`, así que no se puede llamar al constructor de verdad. Lo que el código
 * hace con esto es exactamente `error.response.clone().json()`, y eso es lo que el doble ofrece:
 * ni un campo más, para que el test no acabe fijando una forma que nadie usa.
 */
const errorHttp = (codigo?: string): Error =>
  Object.create(HTTPError.prototype, {
    response: {
      value: {
        clone: () => ({
          json: async () => (codigo === undefined ? {} : { code: codigo }),
        }),
      },
    },
  }) as Error;

const codigo = (seq: number) => ({
  codeId: `c${seq}`,
  uri: `te://requests/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f${seq}`,
  seq,
  displayExpiresAt: new Date(Date.now() + 30_000).toISOString(),
  hardExpiresAt: new Date(Date.now() + 45_000).toISOString(),
});

const apertura = (seq: number) => ({
  verificationId: `v${seq}`,
  sessionId: `s${seq}`,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  code: codigo(seq),
});

beforeEach(() => {
  jest.clearAllMocks();
  olvidarConfigCanal();
  leerConfigCanal.mockResolvedValue({ channels: { qr: true, push: true }, devicePicker: 'lazy' });
  abrirCanalQr.mockResolvedValue(apertura(1));
  rotarCodigo.mockRejectedValue(errorHttp());
  // `retryAfterMs: 0` es la señal de PARAR: una vuelta y el sondeo se detiene.
  sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
});

describe('las tres preguntas de la superficie', () => {
  it.each(['rechazado', 'caducado', 'fallo', 'sesionCaducada'] as const)(
    '`%s` es un canal muerto, así que el código se vela',
    (fase) => {
      expect(canalMuerto(fase)).toBe(true);
    }
  );

  it('`sinRed` NO es un canal muerto: el código puede seguir sirviendo cuando vuelva la red', () => {
    expect(canalMuerto('sinRed')).toBe(false);
  });

  it('`sinRed` sí ofrece reintento: antes decía «reintentando» sin ofrecer nada', () => {
    expect(hayReintento('sinRed')).toBe(true);
  });

  it('el login caducado no ofrece reintento sino empezar de nuevo: no hay nada que reintentar', () => {
    expect(hayReintento('sesionCaducada')).toBe(false);
    expect(pideEmpezarDeNuevo('sesionCaducada')).toBe(true);
  });

  it.each(['esperando', 'escaneado', 'confirmando', 'aprobado'] as const)(
    'esperar no es fallar: `%s` no vela nada ni ofrece reintento',
    (fase) => {
      expect(canalMuerto(fase)).toBe(false);
      expect(hayReintento(fase)).toBe(false);
    }
  );
});

describe('F1 · el canal muere y el código se queda, velado', () => {
  it('el último código sigue pintado y toda su superficie es un botón con nombre', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { container, findByRole } = renderColumna();

    const velo = await findByRole('button', { name: 'te.action.new_code' });

    // Lo que se vela es un código, no un hueco: el lienzo sigue en el DOM, dentro del botón.
    expect(velo.querySelector('canvas')).not.toBeNull();
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('es un `<button>` de verdad: alcanzable con teclado y activable con Enter', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByRole } = renderColumna();

    const velo = await findByRole('button', { name: 'te.action.new_code' });

    // Un `<button>` está en el orden de tabulación sin `tabIndex`, y Enter y Espacio disparan su
    // `click` sin ningún `onKeyDown`. Fijar el elemento es fijar las tres cosas.
    expect(velo.tagName).toBe('BUTTON');
    expect(velo.getAttribute('type')).toBe('button');
    expect(velo.hasAttribute('disabled')).toBe(false);
  });

  it('el código velado no se anuncia como escaneable: ya no lleva a ninguna parte', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { container, findByRole } = renderColumna();

    await findByRole('button', { name: 'te.action.new_code' });

    // El lienzo va dentro de un contenedor `aria-hidden`: mandar a alguien a apuntar la cámara a un
    // código muerto es peor que no decirle nada.
    expect(container.querySelector('canvas')?.closest('[aria-hidden]')).not.toBeNull();
  });

  it('sin código que velar no hay velo: un canal que ni se abrió no promete nada', async () => {
    abrirCanalQr.mockRejectedValue(errorHttp());

    const { container, findByText, queryByRole } = renderColumna();

    await findByText('te.status.unavailable');

    expect(container.querySelector('canvas')).toBeNull();
    expect(queryByRole('button', { name: 'te.action.new_code' })).toBeNull();
    // Y aun así queda salida: el botón de siempre.
    await expect(findByText('te.action.retry')).resolves.not.toBeNull();
  });

  it('en la pantalla propia el marco tampoco desaparece: el mismo velo, el mismo botón', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByRole } = renderPantalla();

    const velo = await findByRole('button', { name: 'te.action.new_code' });

    expect(velo.querySelector('canvas')).not.toBeNull();
  });
});

describe('F3 · «Reintentar» reabre el canal de verdad', () => {
  it('pulsar el código velado acuña un canal nuevo y vuelve a pintar', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByRole, queryByText } = renderColumna();

    const velo = await findByRole('button', { name: 'te.action.new_code' });

    expect(abrirCanalQr).toHaveBeenCalledTimes(1);

    sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });
    abrirCanalQr.mockResolvedValue(apertura(9));

    await act(async () => {
      fireEvent.click(velo);
    });

    await waitFor(() => {
      expect(abrirCanalQr).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(queryByText('te.status.expired')).toBeNull();
    });
  });

  it('el botón de abajo hace lo mismo, en las dos pantallas', async () => {
    sondear.mockResolvedValue({
      frame: { t: 'expired' },
      retryAfterMs: 0,
      cabeceraDate: undefined,
    });

    const { findByText } = renderPantalla();

    const boton = await findByText('te.action.retry');

    await act(async () => {
      fireEvent.click(boton);
    });

    await waitFor(() => {
      expect(abrirCanalQr).toHaveBeenCalledTimes(2);
    });
  });
});

describe('F3 y F4 · cuando lo que caducó es el login entero', () => {
  /*
   * Éste es el fallo tal y como se midió: la interacción OIDC de Logto vive una hora y, pasada esa
   * hora, TODAS las rutas de la experiencia responden `404 session.not_found`. La reapertura del
   * canal empieza por `PUT /api/experience`, así que recibía ese 404, lo contaba como «el canal no
   * sirve» y repintaba la misma pantalla: pulsar «Reintentar» no cambiaba nada.
   */
  it('el sondeo que recibe `session.not_found` lo dice, y no ofrece un reintento imposible', async () => {
    sondear.mockRejectedValue(errorHttp('session.not_found'));

    const { findAllByText, findByText, queryByText } = renderColumna();

    await expect(findByText('te.status.session_expired')).resolves.not.toBeNull();
    expect(queryByText('te.action.retry')).toBeNull();
    // Dos caminos al mismo sitio: el velo sobre el código y el botón de abajo.
    await expect(findAllByText('te.action.restart')).resolves.toHaveLength(2);
  });

  it('no gasta ni una petición más: rotar el código no devuelve un login que ya no existe', async () => {
    sondear.mockRejectedValue(errorHttp('session.not_found'));

    const { findByText } = renderColumna();

    await findByText('te.status.session_expired');

    expect(rotarCodigo).not.toHaveBeenCalled();
  });

  it('«Empezar de nuevo» recarga, que es lo único que puede crear una interacción nueva', async () => {
    sondear.mockRejectedValue(errorHttp('session.not_found'));

    const { findAllByText } = renderColumna();

    const [velo] = await findAllByText('te.action.restart');

    await act(async () => {
      fireEvent.click(velo!);
    });

    expect(reiniciarAcceso).toHaveBeenCalledTimes(1);
    // Y no se ha intentado abrir nada: reabrir el canal necesita la interacción que ya no existe.
    expect(abrirCanalQr).toHaveBeenCalledTimes(1);
  });

  it('un 4xx cualquiera del canal NO se confunde con el login caducado', async () => {
    sondear.mockRejectedValue(errorHttp('session.verification_failed'));

    const { findByText, queryByText } = renderColumna();

    await expect(findByText('te.status.unavailable')).resolves.not.toBeNull();
    expect(queryByText('te.status.session_expired')).toBeNull();
  });
});

describe('F4 · un corte de red al abrir no deja la pantalla esperando un F5', () => {
  it('«Sin conexión. Reintentando…» ahora es verdad: la apertura se repite sola', async () => {
    jest.useFakeTimers();
    abrirCanalQr.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      const { findByText } = renderColumna();

      await findByText('te.status.offline');
      expect(abrirCanalQr).toHaveBeenCalledTimes(1);

      // El fallo ocurrió ANTES de arrancar el sondeo, así que antes no quedaba nada reintentando.
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(abrirCanalQr).toHaveBeenCalledTimes(2);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('y no reabre para siempre: agotado el tope se para y queda el botón', async () => {
    jest.useFakeTimers();
    abrirCanalQr.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      const { findByText } = renderColumna();

      await findByText('te.status.offline');

      const otroCiclo = async () => {
        await act(async () => {
          jest.advanceTimersByTime(4000);
        });
      };

      for (const _ of Array.from({ length: 8 })) {
        // eslint-disable-next-line no-await-in-loop -- son ciclos del reloj, y van en orden.
        await otroCiclo();
      }

      // Una apertura inicial más el tope de reaperturas. Ni una más: una caída larga no puede
      // convertir cada pestaña abierta en un generador de tráfico.
      expect(abrirCanalQr).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('un corte de red deja botón: antes se quedaba sin nada que pulsar', async () => {
    abrirCanalQr.mockRejectedValue(new TypeError('Failed to fetch'));

    const { findByText } = renderColumna();

    await expect(findByText('te.status.offline')).resolves.not.toBeNull();
    await expect(findByText('te.action.retry')).resolves.not.toBeNull();
  });
});

describe('F2 · entrar a la pantalla de factor pide código nuevo', () => {
  it('al montarse abre canal, exactamente una vez', async () => {
    const { findByText } = renderPantalla();

    await findByText('te.qr.pair_code_label');

    expect(abrirCanalQr).toHaveBeenCalledTimes(1);
  });

  it('nace esperando, nunca en un estado agotado que no ha vivido', async () => {
    const { findByText, queryByText } = renderPantalla();

    await findByText('te.status.waiting');

    expect(queryByText('te.action.retry')).toBeNull();
    expect(queryByText('te.status.unavailable')).toBeNull();
  });

  /*
   * La otra mitad de F2: la pantalla se abría «ya rota» cuando lo que estaba muerto era la
   * interacción de Logto, no el canal. Ahora eso tiene nombre y su propia salida, y sobre todo no
   * manda a pulsar un botón incapaz de funcionar.
   */
  it('si lo que está muerto es el login, lo dice al nacer en vez de pedir un reintento', async () => {
    abrirCanalQr.mockRejectedValue(errorHttp('session.not_found'));

    const { findByText, queryByText } = renderPantalla();

    await expect(findByText('te.status.session_expired')).resolves.not.toBeNull();
    expect(queryByText('te.action.retry')).toBeNull();
  });
});

describe('la generación: reabrir cancela, y no duplica', () => {
  /*
   * El caso exacto que el booleano `sondeando` no sabía resolver. Con un corte de red la cadena de
   * sondeo queda DORMIDA, no muerta: el booleano seguía diciendo «ya hay una cadena», así que
   * reabrir no arrancaba ninguna nueva y, peor, la vieja despertaba después y seguía sondeando el
   * canal anterior. La generación corta eso por construcción: la vieja despierta, ve que ya no
   * manda y se aparta.
   */
  it('la cadena dormida de un canal viejo no despierta a sondear el nuevo', async () => {
    jest.useFakeTimers();
    sondear.mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      const { findByText } = renderColumna();

      const boton = await findByText('te.action.retry');

      // Una vuelta, que se cayó. La cadena queda dormida hasta el ritmo de reintento sin red.
      expect(sondear).toHaveBeenCalledTimes(1);

      abrirCanalQr.mockResolvedValue(apertura(2));
      sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 0, cabeceraDate: undefined });

      await act(async () => {
        fireEvent.click(boton);
      });

      await waitFor(() => {
        expect(abrirCanalQr).toHaveBeenCalledTimes(2);
      });

      // La cadena nueva sondea una vez y para (`retryAfterMs: 0`).
      await waitFor(() => {
        expect(sondear).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });

      // Y la vieja, al despertar, no añade ni una vuelta.
      expect(sondear).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('al desmontar, el sondeo se para: una pantalla que ya no está no sondea', async () => {
    jest.useFakeTimers();
    sondear.mockResolvedValue({ frame: { t: 'code' }, retryAfterMs: 500, cabeceraDate: undefined });

    try {
      const { findByText, unmount } = renderColumna();

      await findByText('te.status.waiting');
      await waitFor(() => {
        expect(sondear).toHaveBeenCalled();
      });

      const vueltas = sondear.mock.calls.length;

      unmount();

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(sondear).toHaveBeenCalledTimes(vueltas);
    } finally {
      jest.useRealTimers();
    }
  });
});

/* eslint-enable n/prefer-global/text-encoder, n/prefer-global/text-decoder */
