import { useContext, useEffect, useState } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';

import { useIsRegisterInteraction } from '../flow/use-is-register-interaction';

import { leerConfigCanal, type ConfigCanal } from './api';
import { objetivoConectorTe } from './config';

/**
 * ¿Se puede ofrecer TripleEnable en esta pantalla, y con qué canales?
 *
 * Dos fuentes, y las dos importan:
 *
 * 1. **El conector en la configuración de la experiencia.** `experienceSettings.socialConnectors`
 *    viene de la consola y la vista previa lo sobrescribe, así que apagar el conector en consola
 *    apaga el factor sin desplegar nada. Es síncrono, así que la primera pintura ya es correcta.
 * 2. **Los interruptores del servidor** (`GET …/te-channel/config`), que además son fail-closed:
 *    si te-api no contesta, el servidor responde todo apagado y aquí no se ofrece nada.
 *
 * C4 se aplica antes que las dos: **en el alta no se pregunta siquiera**. La ruta del canal
 * rechaza el registro de todas formas, pero aquí lo que se busca es que no exista la puerta.
 */

type Disponibilidad = {
  /** El conector existe y está encendido en la configuración de la experiencia. */
  readonly hayConector: boolean;
  /** El canal QR se puede ofrecer. */
  readonly hayQr: boolean;
  /** El canal push se puede ofrecer. */
  readonly hayPush: boolean;
  /** `eager` pinta la lista de dispositivos antes del primer despacho. Ver PU-12. */
  readonly politicaSelector: ConfigCanal['devicePicker'];
  /** Falso hasta que la respuesta del servidor ha llegado (o se ha descartado preguntar). */
  readonly resuelto: boolean;
};

/**
 * Una sola petición por carga de página, compartida por todos los que pregunten.
 *
 * La pantalla de acceso monta varios consumidores a la vez —el QR de escritorio, la lista social,
 * las tarjetas de factor—, y sin esto cada uno abriría la suya. El estado vive en el módulo y no
 * en un contexto nuevo a propósito: un contexto obligaría a envolver `App.tsx`, que es upstream.
 */
// eslint-disable-next-line @silverhand/fp/no-let -- caché de proceso; se reinicia con la página.
let peticionEnCurso: Promise<ConfigCanal> | undefined;

const pedirConfig = async (): Promise<ConfigCanal> => {
  // eslint-disable-next-line @silverhand/fp/no-mutation
  peticionEnCurso ??= leerConfigCanal();

  return peticionEnCurso;
};

/** Sólo para los tests: olvida la respuesta cacheada. */
export const olvidarConfigCanal = () => {
  // eslint-disable-next-line @silverhand/fp/no-mutation
  peticionEnCurso = undefined;
};

const apagado: ConfigCanal = Object.freeze({
  channels: { qr: false, push: false },
  devicePicker: 'lazy',
});

/**
 * Los interruptores **esperando** a que el servidor conteste, para quien no pueda decidir con lo
 * que haya llegado hasta ahora.
 *
 * Existe por un fallo concreto y medido: la pantalla del identificador decide a dónde llevar a la
 * persona en el instante en que se pulsa «Sign in». Si eso pasa antes de que la respuesta haya
 * llegado —un gestor de contraseñas que rellena y envía, o sencillamente alguien rápido— la bandera
 * todavía vale `false` y el camino se resuelve como si TripleEnable no existiera: se acaba en la
 * pantalla de contraseña sin haber visto nunca los dos métodos. Un fallo que sólo aparece a veces,
 * que es la peor clase, y que además se confunde con «esta cuenta no tiene cartera».
 *
 * No añade ninguna petición: `pedirConfig` está memoizada y arrancó al montarse la pantalla.
 */
export const interruptoresResueltos = async (): Promise<ConfigCanal> => {
  try {
    return await pedirConfig();
  } catch {
    // Fail-closed, igual que el hook: si no se pudo preguntar, no se ofrece el factor.
    return apagado;
  }
};

const useTeAvailability = (): Disponibilidad => {
  const { experienceSettings } = useContext(PageContext);
  const esAlta = useIsRegisterInteraction();

  const hayConector = (experienceSettings?.socialConnectors ?? []).some(
    ({ target }) => target === objetivoConectorTe
  );

  const debePreguntar = hayConector && !esAlta;

  const [config, setConfig] = useState<ConfigCanal>();

  useEffect(() => {
    if (!debePreguntar) {
      return;
    }

    // La guardia de cancelación va en una variable del efecto, no en una `ref`: una `ref`
    // compartida entre ejecuciones se pone a `false` en la limpieza del efecto anterior justo
    // cuando el siguiente acaba de ponerla a `true`, que es la carrera que tenía la rama previa
    // escrita al revés.
    // eslint-disable-next-line @silverhand/fp/no-let
    let vigente = true;

    const cargar = async () => {
      try {
        const resultado = await pedirConfig();

        if (vigente) {
          setConfig(resultado);
        }
      } catch {
        // Fail-closed: si ni siquiera se pudo preguntar, no se ofrece el factor.
        if (vigente) {
          setConfig(apagado);
        }
      }
    };

    void cargar();

    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      vigente = false;
    };
  }, [debePreguntar]);

  if (!debePreguntar) {
    return {
      hayConector,
      hayQr: false,
      hayPush: false,
      politicaSelector: 'lazy',
      resuelto: true,
    };
  }

  return {
    hayConector,
    hayQr: config?.channels.qr ?? false,
    hayPush: config?.channels.push ?? false,
    politicaSelector: config?.devicePicker ?? 'lazy',
    resuelto: config !== undefined,
  };
};

export default useTeAvailability;
