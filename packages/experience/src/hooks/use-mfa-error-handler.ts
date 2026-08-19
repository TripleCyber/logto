import { MfaFactor, type RequestErrorBody } from '@logto/schemas';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { validate } from 'superstruct';

import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { UserMfaFlow } from '@/types';
import { type MfaFlowState, mfaErrorDataGuard } from '@/types/guard';
import { isNativeWebview } from '@/utils/native-sdk';

import type { ErrorHandlers } from './use-error-handler';
import useStartBackupCodeBinding from './use-start-backup-code-binding';
import useStartTotpBinding from './use-start-totp-binding';
import useStartWebAuthnProcessing from './use-start-webauthn-processing';
import useToast from './use-toast';

export type Options = {
  /** Whether to replace the current page in the history stack on navigation. */
  replace?: boolean;
};

const useMfaErrorHandler = ({ replace }: Options = {}) => {
  const navigate = useNavigateWithPreservedSearchParams();
  const { t } = useTranslation();
  const { setToast } = useToast();
  const startTotpBinding = useStartTotpBinding();
  const startWebAuthnProcessing = useStartWebAuthnProcessing();
  const startBackupCodeBinding = useStartBackupCodeBinding();

  /**
   * Redirect the user to the corresponding MFA page.
   *
   * Binding pages are hosted on following routes:
   * - /{@link UserMfaFlow.MfaBinding} List of available MFA factors for binding.
   * - /{@link UserMfaFlow.MfaBinding}/{@link MfaFactor} Binding page for the specific factor.
   *
   * Verification pages are hosted on following routes:
   * - /{@link UserMfaFlow.MfaVerification} List of available MFA factors for verification.
   * - /{@link UserMfaFlow.MfaVerification}/{@link MfaFactor} Verification page for the specific factor.
   *
   * Redirection rules:
   * - Verification: always redirect to the available factors list page (see the patch below).
   * - If there is only one available factor, redirect to the specific MFA factor page.
   * - If there are multiple available factors:
   *    - Binding: redirect to the available factors list page.
   */
  const handleMfaRedirect = useCallback(
    async (flow: UserMfaFlow, state: MfaFlowState) => {
      const { availableFactors } = state;

      /*
       * LOGTO PATCH(te-push-as-mfa): la verificación siempre pasa por la lista.
       *
       * Upstream saltaba directo al primer factor —el último usado— y con un teléfono vinculado
       * eso significa **mandar un SMS sin haberlo pedido**: se paga, llega a alguien que quizá
       * iba a entrar por otro sitio, y no hubo ninguna elección. Quien acaba de teclear su
       * contraseña tiene derecho a elegir con qué sigue.
       *
       * Y es además la única forma de que «aprobar en el teléfono» sea elegible: la tarjeta no es
       * un `MfaFactor` —ver `TePushMfaCard`— así que vive en la pantalla de la lista, y a esa
       * pantalla no se llegaba nunca cuando había un solo factor vinculado.
       *
       * La vinculación no se toca: ahí no se manda nada al saltar, y con un solo factor la lista
       * sería una pantalla de un botón.
       *
       * Upstream: (verification jumps straight to the last used factor)
       */
      if (flow === UserMfaFlow.MfaVerification) {
        navigate({ pathname: `/${flow}` }, { replace, state });
        return;
      }

      // De aquí abajo el flujo es SIEMPRE la vinculación: la verificación salió arriba. Las
      // comprobaciones de `flow` que había en cada rama sobran, y dejarlas puestas las marca el
      // compilador como comparaciones sin solapamiento.
      if (availableFactors.length > 1) {
        /**
         * Redirect to the MFA binding page if there are multiple available factors.
         */
        navigate({ pathname: `/${flow}` }, { replace, state });
        return;
      }

      /**
       * The first available factor is the only available factor since we handle the multiple
       * factors case above.
       */
      const factor = availableFactors[0];

      if (!factor) {
        /**
         * This should never happen since we check the available factors' length before handling the redirection.
         */
        setToast(t('error.unknown'));
        return;
      }

      if (factor === MfaFactor.TOTP) {
        /**
         * Start TOTP binding process if only TOTP is available.
         */
        return startTotpBinding(state, replace);
      }

      if (factor === MfaFactor.WebAuthn) {
        /**
         * Start WebAuthn processing if only TOTP is available.
         */
        return startWebAuthnProcessing(flow, state, replace);
      }

      /*
       * LOGTO PATCH(te-push-as-mfa): aquí vivían las dos ramas que mandaban el código por correo
       * o por SMS **sin preguntar**. Ya no hacen falta: el envío lo dispara `MfaFactorList` al
       * pulsar la tarjeta, que es donde alguien lo ha pedido. Ver `handleSelectFactor`.
       */

      /**
       * Redirect to the specific MFA factor page.
       */
      navigate({ pathname: `/${flow}/${factor}` }, { replace, state });
    },
    [navigate, replace, setToast, startTotpBinding, startWebAuthnProcessing, t]
  );

  const handleMfaError = useCallback(
    (flow: UserMfaFlow) => {
      return async (error: RequestErrorBody) => {
        if (error.code === 'user.suggest_mfa') {
          navigate({ pathname: `/mfa-onboarding` }, { replace });
          return;
        }

        const [_, data] = validate(error.data, mfaErrorDataGuard);
        const factors = data?.availableFactors ?? [];
        const skippable = data?.skippable;
        const maskedIdentifiers = data?.maskedIdentifiers;
        const suggestion = data?.suggestion;
        const isWebAuthnUsedAsSignInPasskey = data?.isWebAuthnUsedAsSignInPasskey;

        if (factors.length === 0) {
          setToast(error.message);
          return;
        }

        const availableFactors =
          // Hide the webauthn factor on native webview if the user has other options, since it's not supported.
          isNativeWebview() && factors.length > 1
            ? factors.filter((factor) => factor !== MfaFactor.WebAuthn)
            : factors;

        await handleMfaRedirect(flow, {
          availableFactors,
          skippable,
          maskedIdentifiers,
          suggestion,
          isWebAuthnUsedAsSignInPasskey,
        });
      };
    },
    [handleMfaRedirect, navigate, replace, setToast]
  );

  const mfaVerificationErrorHandler = useMemo<ErrorHandlers>(
    () => ({
      'user.suggest_mfa': handleMfaError(UserMfaFlow.MfaBinding),
      'user.missing_mfa': handleMfaError(UserMfaFlow.MfaBinding),
      'session.mfa.require_mfa_verification': handleMfaError(UserMfaFlow.MfaVerification),
      // Optional suggestion to add another MFA during registration
      'session.mfa.suggest_additional_mfa': handleMfaError(UserMfaFlow.MfaBinding),
      'session.mfa.backup_code_required': async () => startBackupCodeBinding(replace),
    }),
    [handleMfaError, replace, startBackupCodeBinding]
  );

  return mfaVerificationErrorHandler;
};

export default useMfaErrorHandler;
