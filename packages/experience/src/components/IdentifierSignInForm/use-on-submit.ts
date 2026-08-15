import type { SignIn } from '@logto/schemas';
import { SignInIdentifier } from '@logto/schemas';
import { conditional } from '@silverhand/essentials';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import useCheckSingleSignOn from '@/hooks/use-check-single-sign-on';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useSendVerificationCode from '@/hooks/use-send-verification-code';
import { useSieMethods } from '@/hooks/use-sie';
import useStartIdentifierPasskeySignInProcessing from '@/hooks/use-start-identifier-passkey-sign-in-processing';
import useToast from '@/hooks/use-toast';
import useTeAvailability, { interruptoresResueltos } from '@/te/channel/use-te-availability'; // LOGTO PATCH(te-factor-choice)
import { UserFlow } from '@/types';

const useOnSubmit = (signInMethods: SignIn['methods']) => {
  const navigate = useNavigateWithPreservedSearchParams();
  const { setToast } = useToast();
  const { t } = useTranslation();
  const { ssoConnectors, passkeySignIn } = useSieMethods();
  const { onSubmit: checkSingleSignOn } = useCheckSingleSignOn();
  const { setIdentifierInputValue } = useContext(UserInteractionContext);
  const { startProcessing: startIdentifierPasskeySignInProcessing } =
    useStartIdentifierPasskeySignInProcessing({
      hideErrorToast: true,
    });
  // LOGTO PATCH(te-factor-choice)
  const {
    hayQr: hayQrTe,
    hayPush: hayPushTe,
    hayConector: hayConectorTe,
    resuelto: canalResuelto,
  } = useTeAvailability();

  const navigateToPasswordPage = useCallback(() => {
    navigate({
      pathname: `/${UserFlow.SignIn}/password`,
    });
  }, [navigate]);

  const {
    errorMessage,
    clearErrorMessage,
    onSubmit: sendVerificationCode,
  } = useSendVerificationCode(UserFlow.SignIn);

  const onSubmit = useCallback(
    async (identifier: SignInIdentifier, value: string) => {
      const method = signInMethods.find((method) => method.identifier === identifier);

      if (!method) {
        throw new Error(`Cannot find method with identifier type ${identifier}`);
      }

      setIdentifierInputValue({ type: identifier, value });

      const { password, isPasswordPrimary, verificationCode } = method;

      // Check if the email is registered with any SSO connectors. If the email is registered with any SSO connectors, we should not proceed to the next step
      if (identifier === SignInIdentifier.Email && ssoConnectors.length > 0) {
        const result = await checkSingleSignOn(value);

        if (result) {
          return;
        }
      }

      /*
       * LOGTO PATCH(te-factor-choice): C2 · con TripleEnable disponible, esto deja de ser un
       * camino único y pasa a ser una elección, así que se lleva a la pantalla de métodos, donde
       * conviven las tarjetas nativas (passkey, contraseña, código) y las dos de TripleEnable.
       *
       * ## Por qué exactamente aquí
       *
       * Después del bloque de SSO y antes del de passkey. SSO gana siempre —si el dominio tiene
       * conector, no hay elección que ofrecer— y passkey no debe dispararse si vamos a ofrecer
       * elección: esa llamada es la que ya filtra el único bit que la pantalla del identificador
       * filtra hoy, y hacerla para nada sería regalarlo sin necesidad.
       *
       * ## Lo que NO hay aquí
       *
       * Ninguna consulta al directorio. No se pregunta si este identificador tiene cartera
       * vinculada: eso sería un oráculo de existencia. Las tarjetas se pintan por configuración,
       * igual que las de contraseña y código. El coste —que quien no tenga cartera pueda elegir
       * un método que acabará en el mensaje uniforme— está argumentado en `TeMethodCards`.
       *
       * ## Y se espera a la respuesta si aún no ha llegado
       *
       * Sólo cuando el conector existe: si no está configurado no hay nada que esperar y el camino
       * de upstream sigue intacto, sin una petición de más.
       *
       * Con el conector puesto sí se espera, porque decidir con la bandera a medio resolver mandaba
       * a la pantalla de contraseña a quien enviase el formulario deprisa —un gestor de contraseñas
       * que rellena y envía, por ejemplo—, así que el mismo identificador daba dos caminos distintos
       * según lo rápido que fuera la red, y el camino corto se parecía mucho a «esta cuenta no tiene
       * cartera». No cuesta una petición más: la de los interruptores arrancó al pintarse la
       * pantalla y está memoizada.
       *
       * Upstream: del bloque SSO se pasaba directamente al de passkey.
       */
      const interruptores =
        hayConectorTe && !canalResuelto ? await interruptoresResueltos() : undefined;
      const canalesTe = interruptores?.channels ?? { qr: hayQrTe, push: hayPushTe };

      if (canalesTe.qr || canalesTe.push) {
        navigate({ pathname: `/${UserFlow.SignIn}/verification-methods` });

        return;
      }

      // Try passkey sign-in first if enabled
      // If the user has no passkeys, fall back to password/verification code
      if (passkeySignIn?.enabled) {
        const passkeySucceeded = await startIdentifierPasskeySignInProcessing({
          type: identifier,
          value,
        });

        if (passkeySucceeded) {
          return;
        }
        // User has no passkeys, continue with other methods
      }

      if (identifier === SignInIdentifier.Username) {
        navigateToPasswordPage();

        return;
      }

      if (password && (isPasswordPrimary || !verificationCode)) {
        navigateToPasswordPage();

        return;
      }

      if (verificationCode) {
        await sendVerificationCode(
          { identifier, value },
          undefined,
          // The email service usage cap blocks the code send. If this method also allows password
          // sign-in, route to the password page instead of stranding the user on the identifier
          // page with no way forward.
          conditional(
            password && {
              'connector.usage_limit_exceeded': () => {
                setToast(t('error.send_verification_code_failed_use_password'));
                navigateToPasswordPage();
              },
            }
          )
        );
      }
    },
    [
      signInMethods,
      setIdentifierInputValue,
      ssoConnectors.length,
      hayQrTe, // LOGTO PATCH(te-factor-choice)
      hayPushTe, // LOGTO PATCH(te-factor-choice)
      hayConectorTe, // LOGTO PATCH(te-factor-choice)
      canalResuelto, // LOGTO PATCH(te-factor-choice)
      navigate, // LOGTO PATCH(te-factor-choice)
      passkeySignIn?.enabled,
      checkSingleSignOn,
      startIdentifierPasskeySignInProcessing,
      navigateToPasswordPage,
      sendVerificationCode,
      setToast,
      t,
    ]
  );

  return {
    errorMessage,
    clearErrorMessage,
    onSubmit,
  };
};

export default useOnSubmit;
