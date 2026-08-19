import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import VerificationMethodCard from '@/pages/SignInVerificationMethods/VerificationMethodCard';

import { rutasTe } from '../config';
import useTeAvailability from '../use-te-availability';

import TeMark from './TeMark';

/**
 * C2 · Tras el identificador, ofrecer QR.
 *
 * ## Por qué el push NO está aquí
 *
 * Esta pantalla va **antes** de la contraseña: la interacción todavía no ha
 * identificado a nadie, así que `identifiedUserId` está vacío y el despacho sale
 * sin titular. te-api no tiene a quién avisar y el reto nace señuelo — se ve en
 * su diario como `logto_no_dice_titular`. El teléfono no suena nunca, y por
 * diseño (PU-4) eso es indistinguible de un rechazo: dos minutos de espera y el
 * mismo mensaje uniforme.
 *
 * Resolverlo pasando el identificador tecleado es justo lo que no se puede
 * hacer, y por dos razones que se refuerzan: sería el oráculo de existencia que
 * PU-4 impide, y haría sonar el teléfono de cualquiera con sólo saber su correo,
 * que es el bombardeo que PU-1 acota. El push tiene que ser el **segundo**
 * factor, nunca el primero y nunca el único.
 *
 * Así que el push vive en la pantalla de segundo factor, donde el titular ya
 * está resuelto: ver `TePushMfaCard`.
 *
 * ## Por qué NO se le pregunta al directorio si esta persona tiene cartera
 *
 * Sería la lectura literal del criterio, y sería un oráculo de existencia en su forma más cruda:
 * quien teclee un correo sabría si tiene cartera vinculada. La rama previa lo hacía con un
 * `GET /te/devices?identifier=<correo en claro>`, sin autenticar y con el identificador en el
 * query string, que además acaba en el registro de acceso, en el APM y en el proxy que termina
 * TLS.
 *
 * Estas tarjetas se pintan **por configuración**, exactamente igual que las de contraseña y
 * código, que leen `signInMethods` y no el directorio. Nunca hay una llamada «¿este correo tiene
 * cartera?».
 *
 * ## Lo que eso cuesta, dicho aquí para que nadie lo descubra tarde
 *
 * Quien no tenga cartera y pulse «aprobar en el móvil» verá una espera y después el mismo mensaje
 * uniforme que quien la tiene y no aprueba. Nunca «no tienes ningún dispositivo». El coste es
 * hasta dos minutos de espera inútil, y se acota con el enlace de «usar otro método», que está
 * siempre visible en la pantalla de espera.
 *
 * La línea base de Logto no empeora con esto. Hoy, con passkey activo, la pantalla del
 * identificador ya filtra un bit —«existe y tiene passkey» contra todo lo demás—, y ese bit
 * confunde la no existencia con la ausencia del factor. Aquí no se añade ninguno.
 *
 * ## Reactividad
 *
 * `useTeAvailability()` sale del conector en `experienceSettings` (consola y vista previa) y de
 * los interruptores del servidor, que son fail-closed. Apagar el conector en consola quita las
 * dos tarjetas sin desplegar nada.
 */
const TeMethodCards = () => {
  const navigate = useNavigateWithPreservedSearchParams();
  const { hayQr } = useTeAvailability();

  if (!hayQr) {
    return null;
  }

  return (
    <VerificationMethodCard
      Icon={TeMark}
      titleKey="te.method.qr_title"
      descriptionKey="te.method.qr_description"
      onClick={() => {
        navigate({ pathname: rutasTe.qr });
      }}
    />
  );
};

export default TeMethodCards;
