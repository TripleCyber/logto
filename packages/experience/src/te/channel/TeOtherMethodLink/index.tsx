import { SignInIdentifier, experience } from '@logto/schemas';
import { useContext } from 'react';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import SwitchToVerificationMethodsLink from '@/components/SwitchToVerificationMethodsLink';
import TextLink from '@/components/TextLink';
import { useSieMethods } from '@/hooks/use-sie';

/**
 * «Usar otro método», siempre a mano.
 *
 * Es un requisito del producto y también la única salida honesta de la espera: quien no tenga
 * cartera y haya llegado hasta aquí va a esperar hasta que el reto caduque, y sin este enlace la
 * espera no tiene fin visible.
 *
 * Reutiliza el componente de Logto —el mismo que usan contraseña, código y passkey— y le pasa
 * exactamente los mismos datos, así que la lógica de a dónde lleva es la de upstream y no una
 * copia que mañana se desvíe. Cuando todavía no hay identificador (el QR de la primera pantalla
 * se puede usar sin teclear nada), esa lógica no tiene nada que ofrecer, y entonces el enlace
 * vuelve al acceso: que es, literalmente, el otro método.
 */

type Props = {
  readonly className?: string;
};

const TeOtherMethodLink = ({ className }: Props) => {
  const { identifierInputValue } = useContext(UserInteractionContext);
  const { signInMethods } = useSieMethods();

  if (!identifierInputValue?.type) {
    return (
      <TextLink
        replace
        className={className}
        text="te.action.other_method"
        to={`/${experience.routes.signIn}`}
      />
    );
  }

  const { type, value } = identifierInputValue;
  const ajuste = signInMethods.find((method) => method.identifier === type);

  return (
    <SwitchToVerificationMethodsLink
      className={className}
      identifier={type === SignInIdentifier.Username ? undefined : type}
      value={value}
      hasPassword={ajuste?.password}
      hasVerificationCode={type !== SignInIdentifier.Username && Boolean(ajuste?.verificationCode)}
    />
  );
};

export default TeOtherMethodLink;
