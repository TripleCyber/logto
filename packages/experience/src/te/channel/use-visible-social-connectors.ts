import { type ExperienceSocialConnector } from '@logto/schemas';

import { objetivoConectorTe } from './config';
import useTeAvailability from './use-te-availability';

/**
 * Qué conectores sociales se pintan **de verdad**, después de aplicar C4.
 *
 * Vive aparte de `SocialSignInList` porque la lista no es la única que necesita la respuesta: las
 * pantallas de acceso y de alta pintan un separador «or» encima, y lo condicionan a
 * `socialConnectors.length > 0` — el número *sin filtrar*. Con TripleEnable como único conector,
 * eso dejaba un separador colgado sobre una lista vacía en el alta entera (C4). Se veía en la
 * pantalla de crear cuenta como un «or» seguido de nada.
 *
 * La regla está en un solo sitio, que era el punto del contrato: quien pregunte, pregunta aquí.
 * Una prop opcional en el componente no valdría porque sería opcional, y repetir el filtro en las
 * cuatro invocaciones es exactamente lo que se quería evitar.
 *
 * Dos reglas:
 *
 * 1. **C4 · en el alta la cartera no se ofrece.** Todo usuario existe primero en Logto y después
 *    se vincula; este conector es de acceso, nunca de creación. `useTeAvailability()` devuelve todo
 *    apagado en una interacción de alta, y ni siquiera pregunta al servidor.
 * 2. **En el acceso la fila se queda SIEMPRE**, en móvil y también en escritorio, y lleva a la
 *    pantalla propia del código.
 *
 * ## Por qué la regla 2 cambió
 *
 * Antes la fila desaparecía en escritorio, con el argumento de que el código ya estaba pintado
 * arriba y dos entradas al mismo factor a diez centímetros eran ruido. Con la tarjeta a dos
 * columnas ese argumento se cae, y por dos motivos:
 *
 * - La columna se enseña por `@media (min-width: 820px)`, no por plataforma. Una ventana de
 *   escritorio a media pantalla no tiene columna, y con la regla vieja tampoco tenía fila: el
 *   factor desaparecía entero de la pantalla sin que nadie lo hubiera apagado.
 * - Quien prefiera el código a pantalla completa —porque le queda lejos, porque quiere el número
 *   de emparejamiento grande— tiene que poder pedirlo.
 *
 * Y deja de haber un `usePlatform()` decidiendo maquetación: quien decide si la columna se ve es
 * una media query, y la fila ya no depende de esa decisión.
 */
export const esConectorTe = ({ target }: ExperienceSocialConnector) =>
  target === objetivoConectorTe;

const useVisibleSocialConnectors = (
  socialConnectors: readonly ExperienceSocialConnector[] = []
): ExperienceSocialConnector[] => {
  const { hayQr } = useTeAvailability();

  return socialConnectors.filter((connector) => !esConectorTe(connector) || hayQr);
};

export default useVisibleSocialConnectors;
