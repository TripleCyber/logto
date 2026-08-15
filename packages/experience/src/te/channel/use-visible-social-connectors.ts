import { type ExperienceSocialConnector } from '@logto/schemas';

import usePlatform from '@/hooks/use-platform';

import { objetivoConectorTe } from './config';
import useTeAvailability from './use-te-availability';

/**
 * Qué conectores sociales se pintan **de verdad**, después de aplicar C1 y C4.
 *
 * Vive aparte de `SocialSignInList` porque la lista no es la única que necesita la respuesta: las
 * pantallas de acceso y de alta pintan un separador «or» encima, y lo condicionan a
 * `socialConnectors.length > 0` — el número *sin filtrar*. Con TripleEnable como único conector,
 * eso dejaba un separador colgado sobre una lista vacía: en escritorio (el botón se retira porque
 * el código ya está arriba) y en el alta entera (C4). Se ve en la pantalla de crear cuenta como un
 * «or» seguido de nada.
 *
 * La regla sigue estando en un solo sitio, que era el punto del contrato: quien pregunte, pregunta
 * aquí. Una prop opcional en el componente no valdría porque sería opcional, y repetir el filtro en
 * las cuatro invocaciones es exactamente lo que se quería evitar.
 *
 * Las tres reglas, sin cambios:
 *
 * 1. **C4 · en el alta la cartera no se ofrece.** Todo usuario existe primero en Logto y después
 *    se vincula; este conector es de acceso, nunca de creación. `useTeAvailability()` devuelve todo
 *    apagado en una interacción de alta, y ni siquiera pregunta al servidor.
 * 2. **C1 · en escritorio el botón desaparece**, porque el código ya está pintado más arriba en la
 *    misma pantalla.
 * 3. **En móvil el botón se queda** y lleva a la pantalla del código: es el único camino al factor
 *    ahí, porque un QR en el móvil no se escanea con ese mismo móvil.
 */
export const esConectorTe = ({ target }: ExperienceSocialConnector) =>
  target === objetivoConectorTe;

const useVisibleSocialConnectors = (
  socialConnectors: readonly ExperienceSocialConnector[] = []
): ExperienceSocialConnector[] => {
  const { platform } = usePlatform();
  const { hayQr } = useTeAvailability();

  return socialConnectors.filter(
    (connector) => !esConectorTe(connector) || (platform === 'mobile' && hayQr)
  );
};

export default useVisibleSocialConnectors;
