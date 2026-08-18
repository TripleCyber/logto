/* TE:BEGIN account-flow */
import i18next from 'i18next';

/**
 * Reescritura de los textos del alta.
 *
 * ## Por qué aquí y no en `packages/phrases-experience`
 *
 * Ahí vive el original, pero cada idioma es un archivo de upstream: añadir claves
 * multiplicaría la superficie del fork por veinte y garantizaría conflictos en cada
 * sincronización. Con `addResourceBundle` se pisan las claves en memoria tras el init, sin
 * tocar un solo archivo ajeno. Si upstream cambia un texto que no reescribimos, ese cambio
 * sigue llegando solo.
 *
 * ## Criterio de reescritura
 *
 * Solo se cambia lo que está mal o lo que no explica el porqué. Los textos de Logto son
 * correctos como textos de sistema; lo que les falta es contexto de producto:
 *
 * - `add_another_mfa_factor` decía "Add **another** 2-step verification" en una pantalla
 *   donde el usuario está añadiendo el primero. Además partía por el guion a dos líneas.
 * - `link_phone_description` decía "For added security" sin decir para qué sirve el
 *   teléfono ni cuándo se usará. Si no se dice, el usuario asume marketing y abandona.
 * - `about_yourself` no explicaba por qué se piden datos ni si son obligatorios.
 *
 * Se conservan intactos los textos de error: los del original son precisos y están
 * probados en veinte idiomas.
 */

type Bundle = Record<string, Record<string, unknown>>;

const en: Bundle = {
  description: {
    link_phone_description:
      'We use it to confirm it is you when you sign in from a new device, and to get you back in if you lose your password.',
    enter_username_description:
      'You can sign in with it instead of your email. Letters, numbers and underscores only.',
    about_yourself: 'A few details about you',
  },
  mfa: {
    add_mfa_factors: 'Protect your account',
    add_mfa_description: 'Pick a second step for signing in. You can add more later.',
    // Logto usa las claves `another` cuando el usuario ya tiene un factor. En el alta no
    // es el caso, pero la pantalla las reutiliza, así que se reescriben las dos.
    add_another_mfa_factor: 'Protect your account',
    add_another_mfa_description: 'Pick a second step for signing in. You can add more later.',
  },
};

const es: Bundle = {
  description: {
    link_phone_description:
      'Lo usamos para confirmar que eres tú al entrar desde un dispositivo nuevo, y para devolverte el acceso si pierdes la contraseña.',
    enter_username_description:
      'Podrás entrar con él en lugar del correo. Solo letras, números y guiones bajos.',
    about_yourself: 'Algunos datos sobre ti',
  },
  mfa: {
    add_mfa_factors: 'Protege tu cuenta',
    add_mfa_description: 'Elige un segundo paso para entrar. Podrás añadir más después.',
    add_another_mfa_factor: 'Protege tu cuenta',
    add_another_mfa_description: 'Elige un segundo paso para entrar. Podrás añadir más después.',
  },
};

const bundles: Readonly<Record<string, Bundle>> = Object.freeze({ en, es });

/**
 * Aplica las reescrituras sobre el idioma activo y sus vecinos.
 *
 * Se llama después de `i18next.init`, cuando los recursos originales ya están cargados: el
 * cuarto argumento (`deep`) conserva las claves que no tocamos y el quinto (`overwrite`)
 * permite pisar las que sí.
 */
const writeBundles = () => {
  for (const [language, bundle] of Object.entries(bundles)) {
    for (const [namespace, resources] of Object.entries(bundle)) {
      i18next.addResourceBundle(language, 'translation', { [namespace]: resources }, true, true);
    }
  }
};

export const applyPhraseOverrides = () => {
  writeBundles();

  /*
   * Reaplicar al cambiar de idioma.
   *
   * `i18n/utils.ts` llama a `addResourceBundle(lng, ns, resource)` SIN el argumento
   * `deep`, y en i18next eso hace un merge superficial: reemplaza enteros los objetos
   * `description` y `mfa`, borrando estas reescrituras. Se dispara en la vista previa de
   * la consola, así que sin esto el admin previsualizaría el alta con los textos de
   * Logto en lugar de los nuestros.
   *
   * El `off` antes del `on` evita acumular manejadores si `initI18n` corre dos veces.
   */
  i18next.off('languageChanged', writeBundles);
  i18next.on('languageChanged', writeBundles);
};
/* TE:END account-flow */
