import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import VerificationMethodCard from '@/pages/SignInVerificationMethods/VerificationMethodCard';

import { rutasTe } from '../config';
import useTeAvailability from '../use-te-availability';

import TeMark from './TeMark';

/**
 * C2 · Tras el identificador, ofrecer QR y push.
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
  const { hayQr, hayPush } = useTeAvailability();

  return (
    <>
      {hayQr && (
        <VerificationMethodCard
          Icon={TeMark}
          titleKey="te.method.qr_title"
          descriptionKey="te.method.qr_description"
          onClick={() => {
            navigate({ pathname: rutasTe.qr });
          }}
        />
      )}
      {hayPush && (
        <VerificationMethodCard
          Icon={TeMark}
          titleKey="te.method.push_title"
          descriptionKey="te.method.push_description"
          onClick={() => {
            navigate({ pathname: rutasTe.push });
          }}
        />
      )}
    </>
  );
};

export default TeMethodCards;
