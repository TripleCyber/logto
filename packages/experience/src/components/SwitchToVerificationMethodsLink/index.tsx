import { useLocation } from 'react-router-dom';

import TextLink from '@/components/TextLink';
import useIdentifierSignInMethods from '@/pages/IdentifierSignIn/use-identifier-sign-in-methods';
import SwitchIcon from '@/shared/assets/icons/switch-icon.svg?react';
import useTeAvailability from '@/te/channel/use-te-availability'; // LOGTO PATCH(te-factor-choice)
import { type VerificationCodeIdentifier } from '@/types';

import PasskeySignInLink from './PasskeySignInLink';
import PasswordSignInLink from './PasswordSignInLink';
import VerificationCodeLink from './VerificationCodeLink';

type Props = {
  readonly className?: string;
  readonly hasPassword?: boolean;
  readonly hasVerificationCode?: boolean;
  readonly identifier?: VerificationCodeIdentifier;
  readonly value?: string;
};

/**
 * Link component shown on the password page and verification code page
 * when passkey sign-in is enabled and the user may have passkey credentials.
 *
 * Navigates to the verification methods selection page that shows all available
 * options (passkey, password, verification code).
 *
 * The verification methods page reads identifier from UserInteractionContext
 * and available methods from useSieMethods(), so no extra state is needed.
 */
const SwitchToVerificationMethodsLink = ({
  className,
  hasPassword,
  hasVerificationCode,
  identifier,
  value,
}: Props) => {
  const { pathname } = useLocation();
  const { identifierHasBoundPasskey, isPasskeySignInEnabled } = useIdentifierSignInMethods();

  /*
   * LOGTO PATCH(te-factor-choice): los factores de TripleEnable **suman al contador** de
   * upstream, no lo cortocircuitan.
   *
   * La rama previa hacía `if (isTePushEnabled) return <TextLink…/>` antes de contar nada, y eso
   * pintaba el enlace también cuando no había ningún otro método al que cambiar: un enlace a una
   * pantalla vacía. Contándolos, la regla de upstream —«sólo ofrece cambiar si hay de verdad más
   * de dos opciones»— sigue siendo la que decide, y sigue decidiendo bien cuando mañana upstream
   * la cambie.
   *
   * Upstream: el array llevaba sólo las tres primeras entradas.
   */
  const { hayQr: hayQrTe, hayPush: hayPushTe } = useTeAvailability();

  const optionCounts = [
    isPasskeySignInEnabled && identifierHasBoundPasskey,
    hasPassword,
    hasVerificationCode,
    hayQrTe, // LOGTO PATCH(te-factor-choice)
    hayPushTe, // LOGTO PATCH(te-factor-choice)
  ].filter(Boolean).length;

  if (optionCounts > 2) {
    return (
      <TextLink
        className={className}
        text="mfa.try_another_verification_method"
        icon={<SwitchIcon />}
        to="/sign-in/verification-methods"
      />
    );
  }

  if (
    isPasskeySignInEnabled &&
    identifierHasBoundPasskey &&
    !pathname.endsWith('/sign-in/passkey') &&
    identifier &&
    value
  ) {
    return <PasskeySignInLink className={className} identifier={identifier} value={value} />;
  }
  if (hasPassword && !pathname.endsWith('/sign-in/password')) {
    return <PasswordSignInLink className={className} />;
  }
  if (hasVerificationCode && !pathname.endsWith('/sign-in/passcode') && identifier && value) {
    return <VerificationCodeLink className={className} identifier={identifier} value={value} />;
  }
  return null;
};

export default SwitchToVerificationMethodsLink;
