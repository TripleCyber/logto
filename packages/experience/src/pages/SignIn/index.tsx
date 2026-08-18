import { AgreeToTermsPolicy, experience, ExtraParamsKey, SignInMode } from '@logto/schemas';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';

import LandingPageLayout from '@/Layout/LandingPageLayout';
import SingleSignOnFormModeContextProvider from '@/Providers/SingleSignOnFormModeContextProvider';
import SingleSignOnFormModeContext from '@/Providers/SingleSignOnFormModeContextProvider/SingleSignOnFormModeContext';
import WebAuthnContextProvider from '@/Providers/WebAuthnContextProvider';
import PasskeySignInButton from '@/components/Button/PasskeySignInButton';
import Divider from '@/components/Divider';
import GoogleOneTap from '@/components/GoogleOneTap';
import TextLink from '@/components/TextLink';
import SocialSignInList from '@/containers/SocialSignInList';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import TermsAndPrivacyLinks from '@/containers/TermsAndPrivacyLinks';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { useSieMethods } from '@/hooks/use-sie';
import useTerms from '@/hooks/use-terms';
import TeSignInAside from '@/te/channel/TeSignInAside'; // LOGTO PATCH(te-signin-split)
import useVisibleSocialConnectors from '@/te/channel/use-visible-social-connectors'; // LOGTO PATCH(te-qr-desktop)

import ErrorPage from '../ErrorPage';

import Main from './Main';
import styles from './index.module.scss';

const SignInFooters = () => {
  const { t } = useTranslation();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();

  const {
    signInMethods,
    signUpMethods,
    socialConnectors,
    signInMode,
    singleSignOnEnabled,
    passkeySignIn,
  } = useSieMethods();

  const { showSingleSignOnForm } = useContext(SingleSignOnFormModeContext);

  // LOGTO PATCH(te-qr-desktop): ver el comentario del separador, más abajo.
  const conectoresSocialesVisibles = useVisibleSocialConnectors(socialConnectors);

  const handleSsoNavigation = useCallback(async () => {
    /**
     * Check if the user has agreed to the terms and privacy policy before navigating to the SSO page
     * when the policy is set to `Manual`
     */
    if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
      return;
    }
    navigate('/single-sign-on/email');
  }, [agreeToTermsPolicy, navigate, termsValidation]);

  /* Hide footers when showing Single Sign On form */
  if (showSingleSignOnForm) {
    return null;
  }

  return (
    <>
      {
        // Single Sign On footer
        singleSignOnEnabled && (
          <>
            <div className={styles.singleSignOn}>
              {t('description.use')}{' '}
              <TextLink text="action.single_sign_on" onClick={handleSsoNavigation} />
            </div>
            {
              /**
               * If only SSO sign-in methods are available, display the agreement checkbox when the agreement policy is `Manual`.
               */
              signInMethods.length === 0 &&
                socialConnectors.length === 0 &&
                agreeToTermsPolicy === AgreeToTermsPolicy.Manual && (
                  <TermsAndPrivacyCheckbox className={styles.checkboxForSsoOnly} />
                )
            }
          </>
        )
      }
      {
        // Create Account footer
        signInMode === SignInMode.SignInAndRegister && signUpMethods.length > 0 && (
          <div className={styles.createAccount}>
            {t('description.no_account')}{' '}
            <TextLink replace to="/register" text="action.create_account" />
          </div>
        )
      }
      {
        /*
         * LOGTO PATCH(te-qr-desktop): el separador se condiciona a los conectores que de verdad se
         * pintan, no a los configurados. En escritorio la cartera se retira de la lista (el código
         * ya está arriba) y con ella como único conector esto dejaba un «or» sobre nada.
         *
         * Upstream: `socialConnectors.length > 0`.
         */
        // Social sign-in methods
        signInMethods.length > 0 && conectoresSocialesVisibles.length > 0 && (
          <>
            <Divider label="description.or" className={styles.divider} />
            <SocialSignInList socialConnectors={socialConnectors} className={styles.main} />
          </>
        )
      }
      {passkeySignIn?.enabled && passkeySignIn.showPasskeyButton && <PasskeySignInButton />}
    </>
  );
};

const SignIn = () => {
  const { signInMethods, socialConnectors, signInMode } = useSieMethods();
  const { agreeToTermsPolicy } = useTerms();
  const [params] = useSearchParams();

  if (!signInMode) {
    return <ErrorPage />;
  }

  if (signInMode === SignInMode.Register) {
    return <Navigate to="/register" />;
  }

  if (params.get(ExtraParamsKey.OneTimeToken)) {
    return (
      <Navigate
        replace
        to={{ pathname: `/${experience.routes.oneTimeToken}`, search: `?${params.toString()}` }}
      />
    );
  }

  return (
    <LandingPageLayout title="description.sign_in_to_your_account">
      <GoogleOneTap context="signin" />
      {/*
        LOGTO PATCH(te-signin-split): C1 · la columna del código de TripleEnable.

        Va ANTES del formulario a propósito, y no donde se pinta. En pantalla está a la izquierda
        —la saca del flujo `position: absolute`, ver su hoja—, y este orden es el que hace que el
        recorrido con teclado y con lector de pantalla siga el mismo camino que la vista: primero
        la vía que no pide teclear nada, después el formulario.

        Antes esto era `<TeQrInline/>` entre `<Main/>` y `<SignInFooters/>`, es decir, el código
        apilado debajo del formulario y estrecho. La columna es la maqueta aprobada.

        El componente decide solo si existe: sin conector encendido en la consola o con te-api
        caída no pinta nada, y entonces la tarjeta vuelve a su ancho de siempre.

        Upstream: `<Main/>` y `<SignInFooters/>` sin nada en medio.
      */}
      <TeSignInAside />
      <WebAuthnContextProvider>
        <SingleSignOnFormModeContextProvider>
          <Main signInMethods={signInMethods} socialConnectors={socialConnectors} />
          <SignInFooters />
        </SingleSignOnFormModeContextProvider>
      </WebAuthnContextProvider>
      {
        // Only show terms and privacy links for sign in page if the agree to terms policy is `Automatic` or `ManualRegistrationOnly`
        agreeToTermsPolicy !== AgreeToTermsPolicy.Manual && (
          <TermsAndPrivacyLinks className={styles.terms} />
        )
      }
    </LandingPageLayout>
  );
};

export default SignIn;
