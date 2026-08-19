import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import VerificationMethodCard from '@/pages/SignInVerificationMethods/VerificationMethodCard';

import { rutasTe } from '../config';
import TeMark from '../TeMethodCards/TeMark';
import useTeAvailability from '../use-te-availability';

/**
 * LOGTO PATCH(te-push-as-mfa): aprobar en el teléfono, ofrecido en la pantalla de segundo factor.
 *
 * ## Por qué el push va aquí y el QR no
 *
 * El push **necesita** saber a quién avisar antes de empezar, así que sólo tiene sentido después
 * de que alguien haya dicho quién es. La pantalla de segundo factor es exactamente ese momento: ya
 * hubo un identificador y un primer factor —contraseña o código—, y el titular está resuelto.
 *
 * El QR es lo contrario: trae la identidad y la prueba a la vez, así que vive al principio y no
 * tiene sentido como «segundo» de nada.
 *
 * ## Por qué no es un `MfaFactor` de Logto
 *
 * Porque `MfaFactor` es un enumerado cerrado que atraviesa seis paquetes —consola, cuenta,
 * esquemas—, y la lista de factores se cruza con lo que el titular tiene **vinculado**. Aquí no
 * hay nada que vincular: tener la cartera enrolada ya es el vínculo, y se hizo con una firma y una
 * biometría, no escaneando un código.
 *
 * Así que esta tarjeta se pinta **al lado** de los factores que devuelve el servidor, no dentro. Lo
 * que hace que valga como segundo factor no está aquí sino en el servidor: ver
 * `hasVerifiedTeChannel` en `experience-interaction.ts`.
 *
 * ## Reactividad
 *
 * `useTeAvailability()` sale del conector en `experienceSettings` y de los interruptores del
 * servidor, que son fail-closed. Apagar el canal push en te-api o el conector en la consola quita
 * esta tarjeta sin desplegar nada.
 */
const TePushMfaCard = () => {
  const navigate = useNavigateWithPreservedSearchParams();
  const { hayPush } = useTeAvailability();

  if (!hayPush) {
    return null;
  }

  return (
    <VerificationMethodCard
      Icon={TeMark}
      titleKey="te.method.push_title"
      descriptionKey="te.method.push_description"
      onClick={() => {
        navigate({ pathname: rutasTe.push });
      }}
    />
  );
};

export default TePushMfaCard;
