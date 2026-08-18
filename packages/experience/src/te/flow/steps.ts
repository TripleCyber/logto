/* TE:BEGIN account-flow */
import { MfaPolicy } from '@logto/schemas';

/**
 * Modelo de pasos del alta.
 *
 * ## Por qué agrupado y no "paso 3 de 8"
 *
 * El alta real son ocho pantallas: correo, código, usuario, teléfono, código, contraseña,
 * perfil y MFA. Enseñar "3 de 8" es honesto pero desalienta: el usuario cuenta lo que le
 * falta. Agrupar en tres fases da la misma orientación sin el efecto de lista larga, que
 * es lo que hacen Google y Apple.
 *
 * ## Por qué se deriva de la ruta
 *
 * Logto decide el siguiente paso en el servidor (`profile-validator.ts`) y la SPA solo
 * reacciona a un 422. No hay estado de "paso actual" que consultar. La ruta es el único
 * dato fiable, y además sobrevive a que el usuario entre a media sesión o use "Atrás".
 *
 * ## Reactividad a la configuración
 *
 * Las fases NO son fijas: se derivan de lo que la consola tenga activado. Si mañana se
 * quita el MFA obligatorio o los campos de perfil, esa fase desaparece del indicador sola.
 * Ver `useFlowProgress`.
 */

/**
 * ## Por qué cinco fases y no tres
 *
 * La primera versión agrupaba en tres, y el resultado era peor que no tener indicador:
 * el rótulo decía "paso 1 de 3" durante **cinco pantallas seguidas** (correo, código,
 * usuario, teléfono, código). El usuario hacía el 60 % del trabajo mientras el contador
 * no se movía, y un indicador que no avanza se lee como roto.
 *
 * Con cinco fases la barra avanza cada una o dos pantallas. Ninguna fase agrupa más de
 * tres, que es el techo por encima del cual el estancamiento se nota.
 */
export enum FlowPhase {
  /** Correo y su código. */
  Account = 'account',
  /** Usuario, teléfono y su código. */
  Identity = 'identity',
  /** Contraseña. */
  Access = 'access',
  /** Datos personales (custom profile fields). */
  Profile = 'profile',
  /** Passkey y segundo factor. */
  Security = 'security',
}

/** Orden de presentación. Coincide con el orden real que impone el servidor. */
export const flowPhaseOrder: readonly FlowPhase[] = Object.freeze([
  FlowPhase.Account,
  FlowPhase.Identity,
  FlowPhase.Access,
  FlowPhase.Profile,
  FlowPhase.Security,
]);

/**
 * Prefijos de ruta → fase. Se evalúan de más específico a menos, así que el orden importa:
 * `/continue/extra-profile` tiene que ganar a `/continue`.
 */
const routePhaseRules: ReadonlyArray<readonly [prefix: string, phase: FlowPhase]> = Object.freeze([
  ['/continue/extra-profile', FlowPhase.Profile],
  ['/continue/password', FlowPhase.Access],
  ['/continue/username', FlowPhase.Identity],
  ['/continue/phone', FlowPhase.Identity],
  ['/continue/email', FlowPhase.Identity],
  ['/continue/emailOrPhone', FlowPhase.Identity],
  // El código del teléfono llega por la ruta genérica `/:flow/verification-code`; dentro
  // del alta eso es `/continue/verification-code` y pertenece a la fase del teléfono.
  ['/continue/verification-code', FlowPhase.Identity],
  // La passkey y el MFA son la misma promesa para el usuario —proteger la cuenta— aunque
  // Logto los trate como mecanismos distintos. Van juntos en "Seguridad".
  ['/create-passkey', FlowPhase.Security],
  ['/mfa-onboarding', FlowPhase.Security],
  ['/mfa-binding', FlowPhase.Security],
  // `/register` cubre también `/register/verification-code`, el código del correo.
  ['/register', FlowPhase.Account],
  // Red de seguridad: cualquier `/continue/*` que Logto añada en el futuro cae aquí en
  // vez de quedarse sin tema ni indicador.
  ['/continue', FlowPhase.Access],
]);

/**
 * Rutas que SOLO existen dentro del alta: verlas ya prueba que se está registrando.
 */
const registerOnlyPrefixes: readonly string[] = Object.freeze([
  '/register',
  '/identifier-register',
]);

/**
 * Rutas COMPARTIDAS con el acceso.
 *
 * `/continue/*`, `/mfa-*` y `/create-passkey` no pertenecen al registro: el manejador de
 * errores de Logto lleva a ellas también desde sign-in — un usuario existente al que le
 * falta el segundo factor, o un login social sin correo. Sin este filtro, ese usuario
 * vería el lienzo del alta y el rótulo "SEGURIDAD · PASO 5 DE 5" de un registro que no
 * está haciendo.
 *
 * Por eso reclamarlas exige confirmación explícita de que la interacción es un alta.
 */
const sharedWithSignInPrefixes: readonly string[] = Object.freeze([
  '/continue',
  '/mfa-onboarding',
  '/mfa-binding',
  '/create-passkey',
]);

/**
 * Políticas en las que el servidor **no** pide MFA durante el alta.
 *
 * Se expresa en negativo a propósito: `MfaPolicy` tiene seis valores y cuatro de ellos
 * prompean durante el registro. Comprobar solo `Mandatory` —como hacía la primera
 * versión— dejaba fuera `PromptAtSignInAndSignUp`, que es la política **por defecto**;
 * con ella el indicador prometía cuatro fases y luego desaparecía por completo al llegar
 * a `/mfa-onboarding`, porque la fase actual no estaba entre las activas.
 *
 * Con la lista en negativo, cualquier política nueva que Logto añada entra sola.
 * Criterio tomado de `core/src/routes/experience/classes/mfa.ts`.
 */
const policiesWithoutSignUpPrompt: readonly MfaPolicy[] = Object.freeze([
  MfaPolicy.NoPrompt,
  MfaPolicy.PromptOnlyAtSignIn,
  MfaPolicy.PromptOnlyAtSignInMandatory,
]);

/** Si el alta va a pedir un segundo factor con la configuración actual. */
export const promptsMfaAtSignUp = (mfa: {
  policy: MfaPolicy;
  factors: readonly unknown[];
}): boolean => mfa.factors.length > 0 && !policiesWithoutSignUpPrompt.includes(mfa.policy);

const hasPrefix = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => pathname.startsWith(prefix));

/**
 * Fase a la que pertenece una ruta, o `undefined` si no es del flujo de alta.
 *
 * `pathname` acepta `undefined` porque una veintena de tests mockean `react-router-dom`
 * con `useLocation: () => ({})`. Fuera de un Router de verdad `useLocation()` lanza, así
 * que esto NO es una excusa para montar estos componentes sin Router.
 *
 * @param isRegisterInteraction Si la interacción en curso es un alta. Solo se consulta
 * para las rutas compartidas con el acceso; las exclusivas del alta no lo necesitan.
 */
export const getPhaseForPath = (
  pathname: string | undefined,
  isRegisterInteraction: boolean
): FlowPhase | undefined => {
  if (!pathname) {
    return;
  }

  if (
    !isRegisterInteraction &&
    hasPrefix(pathname, sharedWithSignInPrefixes) &&
    !hasPrefix(pathname, registerOnlyPrefixes)
  ) {
    return;
  }

  return routePhaseRules.find(([prefix]) => pathname.startsWith(prefix))?.[1];
};

/** Si la ruta forma parte del alta. Es también el interruptor del tema visual. */
export const isRegisterFlowPath = (
  pathname: string | undefined,
  isRegisterInteraction: boolean
): boolean => getPhaseForPath(pathname, isRegisterInteraction) !== undefined;
/* TE:END account-flow */
