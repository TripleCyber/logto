import { AgreeToTermsPolicy, experience, ExtraParamsKey, SignInMode } from '@logto/schemas';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';

import LandingPageLayout from '@/Layout/LandingPageLayout';
import SingleSignOnFormModeContextProvider from '@/Providers/SingleSignOnFormModeContextProvider';
import SingleSignOnFormModeContext from '@/Providers/SingleSignOnFormModeContextProvider/SingleSignOnFormModeContext';
import Divider from '@/components/Divider';
import GoogleOneTap from '@/components/GoogleOneTap';
import IdentifierRegisterForm from '@/components/IdentifierRegisterForm';
import TextLink from '@/components/TextLink';
import SocialSignInList from '@/containers/SocialSignInList';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import TermsAndPrivacyLinks from '@/containers/TermsAndPrivacyLinks';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { useSieMethods } from '@/hooks/use-sie';
import useTerms from '@/hooks/use-terms';
import useVisibleSocialConnectors from '@/te/channel/use-visible-social-connectors'; // LOGTO PATCH(te-register-no-wallet)

import ErrorPage from '../ErrorPage';

import styles from './index.module.scss';

const RegisterFooter = () => {
  const { t } = useTranslation();
  const { signUpMethods, socialConnectors, signInMode, signInMethods, singleSignOnEnabled } =
    useSieMethods();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();
  const [params] = useSearchParams();

  // LOGTO PATCH(te-register-no-wallet): ver el comentario del separador, más abajo.
  const conectoresSocialesVisibles = useVisibleSocialConnectors(socialConnectors);

  const { showSingleSignOnForm } = useContext(SingleSignOnFormModeContext);

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

  if (params.get(ExtraParamsKey.OneTimeToken)) {
    return (
      <Navigate
        replace
        to={{ pathname: `/${experience.routes.oneTimeToken}`, search: `?${params.toString()}` }}
      />
    );
  }

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
                  <TermsAndPrivacyCheckbox className={styles.checkbox} />
                )
            }
          </>
        )
      }
      {
        // SignIn footer
        signInMode === SignInMode.SignInAndRegister && signInMethods.length > 0 && (
          <div className={styles.createAccount}>
            {t('description.have_account')} <TextLink replace to="/sign-in" text="action.sign_in" />
          </div>
        )
      }
      {
        // Social sign-in methods
        /*
         * LOGTO PATCH(te-register-no-wallet): el separador se condiciona a lo que de verdad se
         * pinta. En el alta la cartera nunca se ofrece (C4), así que con ella como único conector
         * esto dejaba un «or» seguido de nada en la pantalla de crear cuenta.
         *
         * Upstream: `socialConnectors.length > 0`.
         */
        signUpMethods.length > 0 && conectoresSocialesVisibles.length > 0 && (
          <>
            <Divider label="description.or" className={styles.divider} />
            <SocialSignInList socialConnectors={socialConnectors} className={styles.main} />
          </>
        )
      }
    </>
  );
};

const Register = () => {
  const { signUpMethods, socialConnectors, signInMode } = useSieMethods();
  const { agreeToTermsPolicy } = useTerms();
  // LOGTO PATCH(te-register-no-wallet): lo que de verdad se pinta, no lo configurado.
  const conectoresSocialesVisiblesPagina = useVisibleSocialConnectors(socialConnectors);

  if (!signInMode) {
    return <ErrorPage />;
  }

  if (signInMode === SignInMode.SignIn) {
    return <Navigate to="/sign-in" />;
  }

  return (
    <LandingPageLayout title="description.create_your_account">
      <GoogleOneTap context="signup" />
      <SingleSignOnFormModeContextProvider>
        {signUpMethods.length > 0 && (
          <IdentifierRegisterForm signUpMethods={signUpMethods} className={styles.main} />
        )}
        {/* Social sign-in methods only */}
        {/* LOGTO PATCH(te-register-no-wallet): idem, para el alta sólo-social. */}
        {signUpMethods.length === 0 && conectoresSocialesVisiblesPagina.length > 0 && (
          <>
            {agreeToTermsPolicy !== AgreeToTermsPolicy.Automatic && (
              <TermsAndPrivacyCheckbox className={styles.terms} />
            )}
            <SocialSignInList className={styles.main} socialConnectors={socialConnectors} />
          </>
        )}
        <RegisterFooter />
        {agreeToTermsPolicy === AgreeToTermsPolicy.Automatic && (
          <TermsAndPrivacyLinks className={styles.terms} />
        )}
      </SingleSignOnFormModeContextProvider>
      {/* Hide footer elements when showing Single Sign On form */}
    </LandingPageLayout>
  );
};

export default Register;
