/* TE:BEGIN account-flow */
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import PageContext from '@/Providers/PageContextProvider/PageContext';

import { getFlowCopy } from './copy';
import { FlowPhase, flowPhaseOrder, getPhaseForPath, promptsMfaAtSignUp } from './steps';
import { useIsRegisterInteraction } from './use-is-register-interaction';

export type FlowStep = {
  readonly phase: FlowPhase;
  readonly label: string;
  /** Qué se pedirá en esta fase. Solo se usa en la primera pantalla. */
  readonly summary: string;
  readonly isCurrent: boolean;
  readonly isDone: boolean;
};

export type FlowProgress = {
  readonly steps: readonly FlowStep[];
  /** 1-indexado, para lectores de pantalla. */
  readonly currentIndex: number;
  readonly ariaLabel: string;
  /** Rótulo visible sobre la barra. */
  readonly caption: string;
};

/**
 * Deriva el progreso del alta a partir de la ruta actual y de la configuración de la
 * consola.
 *
 * Las fases **no están fijas**. Si en la consola se quitan los campos de perfil o se deja
 * el MFA en opcional, esas fases desaparecen del indicador sin tocar código. Esa es la
 * regla del fork: cada pantalla reacciona a la configuración, y el indicador no puede ser
 * la excepción — un progreso que promete un paso que no va a ocurrir es peor que no tener
 * progreso.
 *
 * Devuelve `undefined` cuando la ruta no pertenece al alta, o cuando solo quedaría una
 * fase: un indicador de un solo paso es ruido, no orientación.
 */
export const useFlowProgress = (): FlowProgress | undefined => {
  const { pathname } = useLocation();
  const { experienceSettings } = useContext(PageContext);
  const { i18n } = useTranslation();
  const isRegisterInteraction = useIsRegisterInteraction();

  return useMemo(() => {
    const currentPhase = getPhaseForPath(pathname, isRegisterInteraction);

    if (!currentPhase || !experienceSettings) {
      return;
    }

    const copy = getFlowCopy(i18n.language);
    const { signUpProfileFields, mfa, signUp, passkeySignIn } = experienceSettings;

    /*
     * Cada fase existe solo si la consola la ha activado. Sin esto el indicador
     * prometería pasos que nunca van a ocurrir, que es peor que no indicar nada.
     */
    const isPhaseActive: Readonly<Record<FlowPhase, boolean>> = {
      // El identificador primario siempre se pide: es por donde empieza el alta.
      [FlowPhase.Account]: true,
      [FlowPhase.Identity]: (signUp.secondaryIdentifiers ?? []).length > 0,
      [FlowPhase.Access]: signUp.password,
      [FlowPhase.Profile]: (signUpProfileFields ?? []).length > 0,
      // `passkeySignIn` es opcional en la respuesta de la experiencia, de ahí el `?? false`.
      [FlowPhase.Security]: promptsMfaAtSignUp(mfa) || (passkeySignIn.enabled ?? false),
    };

    const activePhases = flowPhaseOrder.filter((phase) => isPhaseActive[phase]);

    if (activePhases.length < 2) {
      return;
    }

    const currentIndex = activePhases.indexOf(currentPhase);

    // La fase actual puede estar desactivada si la configuración cambió a mitad de sesión.
    // Preferimos no pintar nada antes que pintar algo incoherente.
    if (currentIndex === -1) {
      return;
    }

    return {
      steps: activePhases.map((phase, index) => ({
        phase,
        label: copy.phases[phase],
        summary: copy.whatsNext[phase],
        isCurrent: index === currentIndex,
        isDone: index < currentIndex,
      })),
      currentIndex: currentIndex + 1,
      ariaLabel: copy.progressLabel(
        currentIndex + 1,
        activePhases.length,
        copy.phases[currentPhase]
      ),
      caption: copy.progressCaption(
        currentIndex + 1,
        activePhases.length,
        copy.phases[currentPhase]
      ),
    };
  }, [pathname, isRegisterInteraction, experienceSettings, i18n.language]);
};
/* TE:END account-flow */
