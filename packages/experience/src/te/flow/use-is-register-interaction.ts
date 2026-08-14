/* TE:BEGIN account-flow */
import { InteractionEvent } from '@logto/schemas';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { validate } from 'superstruct';

import { continueFlowStateGuard } from '@/types/guard';

/**
 * Marca de sesión: "esta interacción es un alta".
 *
 * ## Por qué hace falta
 *
 * `/continue/*`, `/mfa-*` y `/create-passkey` son rutas compartidas: se llega a ellas
 * tanto registrándose como iniciando sesión. La ruta sola no distingue el caso, y sin
 * distinguirlo el tema y el indicador del alta se le aparecen a un usuario existente.
 *
 * ## Cómo se detecta
 *
 * Dos fuentes, en este orden:
 *
 * 1. `location.state.interactionEvent`, que Logto propaga a las rutas `/continue/*` y
 *    `/create-passkey` (`use-required-profile-error-handler.ts`,
 *    `use-missing-passkey-error-handler.ts`).
 * 2. Una marca en `sessionStorage`, necesaria porque las rutas de MFA **no** propagan ese
 *    estado. Se escribe al pisar una ruta exclusiva del alta y se borra al volver al
 *    acceso, así que no sobrevive a un cambio de flujo.
 *
 * `sessionStorage` y no una variable de módulo: la experiencia de Logto navega con
 * recargas completas en varios puntos (callbacks sociales, `redirectTo`), y una variable
 * en memoria se perdería justo donde más falta hace.
 */
const storageKey = 'te:register-interaction';

/** Rutas cuya sola presencia prueba que se está registrando. */
const registerEntryPrefixes = ['/register', '/identifier-register'];

/** Rutas que prueban que se está accediendo, no registrando. */
const signInEntryPrefixes = ['/sign-in', '/identifier-sign-in', '/forgot-password'];

const readFlag = (): boolean => {
  try {
    return sessionStorage.getItem(storageKey) === '1';
  } catch {
    // Safari en navegación privada lanza al tocar sessionStorage. Preferimos no pintar
    // el tema antes que romper el alta.
    return false;
  }
};

const writeFlag = (value: boolean) => {
  try {
    if (value) {
      sessionStorage.setItem(storageKey, '1');
    } else {
      sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Ver arriba: sin almacenamiento, el tema se limita a las rutas exclusivas del alta.
  }
};

export const useIsRegisterInteraction = (): boolean => {
  // `pathname` puede faltar: una veintena de tests mockean `react-router-dom` con
  // `useLocation: () => ({})`. Sin este respaldo, el hook tumba pantallas que no tienen
  // nada que ver con el alta — pasó exactamente eso con `SocialLinkAccount`.
  const { pathname = '', state } = useLocation();

  const isRegisterEntry = registerEntryPrefixes.some((prefix) => pathname.startsWith(prefix));
  const isSignInEntry = signInEntryPrefixes.some((prefix) => pathname.startsWith(prefix));

  const [, continueFlowState] = validate(state, continueFlowStateGuard);
  const isRegisterByState = continueFlowState?.interactionEvent === InteractionEvent.Register;

  useEffect(() => {
    if (isRegisterEntry || isRegisterByState) {
      writeFlag(true);
      return;
    }

    if (isSignInEntry) {
      writeFlag(false);
    }
  }, [isRegisterEntry, isRegisterByState, isSignInEntry]);

  // Se lee en el mismo render que se escribe, así que la marca no puede ir sola: en el
  // primer render de `/register` el efecto aún no ha corrido.
  return isRegisterEntry || isRegisterByState || (!isSignInEntry && readFlag());
};
/* TE:END account-flow */
