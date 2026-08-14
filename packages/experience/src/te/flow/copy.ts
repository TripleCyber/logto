/* TE:BEGIN account-flow */
/**
 * Textos propios del flujo de alta.
 *
 * ## Por qué no van en `packages/phrases-experience`
 *
 * Ahí es donde Logto guarda los suyos, y sería lo natural — pero cada idioma es un archivo
 * de upstream, así que añadir claves multiplicaría la superficie del fork por veinte y
 * garantizaría conflictos en cada sincronización. Manteniéndolos aquí, el coste de merge
 * es cero y seguimos soportando varios idiomas.
 *
 * Si algún día estos textos tienen que ser editables desde la consola, el sitio es
 * `sign_in_experiences.customContent`, no este archivo.
 */

import { FlowPhase } from './steps';

type PhaseCopy = Record<FlowPhase, string>;

type Locale = {
  /** Etiqueta corta de cada fase. Va bajo el indicador, así que tiene que ser de una palabra. */
  readonly phases: PhaseCopy;
  /** Se lee en voz alta para lectores de pantalla: "Paso 2 de 3: Perfil". */
  readonly progressLabel: (current: number, total: number, phase: string) => string;
  /**
   * Rótulo visible sobre la barra: "Perfil · paso 2 de 3".
   * La fase va primero porque es lo que orienta; el número, después, porque es lo que
   * tranquiliza. Al revés se lee como una cuenta atrás.
   */
  readonly progressCaption: (current: number, total: number, phase: string) => string;
  /** Título del bloque "qué viene después" en la primera pantalla. */
  readonly whatsNextTitle: string;
  /** Qué se pedirá en cada fase. Se une en una sola frase, no en una lista. */
  readonly whatsNext: PhaseCopy;
  /**
   * Envuelve la enumeración: "Te pediremos {lista}."
   *
   * Va como frase y no como lista con viñetas a propósito: con cinco fases, una lista
   * ocupa diez líneas y se lee como un formulario largo — el efecto contrario al que
   * se busca, que es tranquilizar antes de empezar.
   */
  readonly whatsNextSentence: (items: string) => string;
  /** Une la enumeración con el conector del idioma ("a, b y c"). */
  readonly listConjunction: string;
};

const en: Locale = {
  phases: {
    [FlowPhase.Account]: 'Account',
    [FlowPhase.Identity]: 'Identity',
    [FlowPhase.Access]: 'Access',
    [FlowPhase.Profile]: 'Profile',
    [FlowPhase.Security]: 'Security',
  },
  progressLabel: (current, total, phase) => `Step ${current} of ${total}: ${phase}`,
  progressCaption: (current, total, phase) => `${phase} · step ${current} of ${total}`,
  whatsNextTitle: "What you'll set up",
  whatsNext: {
    [FlowPhase.Account]: 'your email',
    [FlowPhase.Identity]: 'a username and phone',
    [FlowPhase.Access]: 'a password',
    [FlowPhase.Profile]: 'a few details about you',
    [FlowPhase.Security]: 'a second step to sign in',
  },
  whatsNextSentence: (items) => `We'll ask for ${items}. It takes about two minutes.`,
  listConjunction: 'and',
};

const es: Locale = {
  phases: {
    [FlowPhase.Account]: 'Cuenta',
    [FlowPhase.Identity]: 'Identidad',
    [FlowPhase.Access]: 'Acceso',
    [FlowPhase.Profile]: 'Perfil',
    [FlowPhase.Security]: 'Seguridad',
  },
  progressLabel: (current, total, phase) => `Paso ${current} de ${total}: ${phase}`,
  progressCaption: (current, total, phase) => `${phase} · paso ${current} de ${total}`,
  whatsNextTitle: 'Lo que vas a configurar',
  whatsNext: {
    [FlowPhase.Account]: 'tu correo',
    [FlowPhase.Identity]: 'un usuario y un teléfono',
    [FlowPhase.Access]: 'una contraseña',
    [FlowPhase.Profile]: 'algunos datos sobre ti',
    [FlowPhase.Security]: 'un segundo paso para entrar',
  },
  whatsNextSentence: (items) => `Te pediremos ${items}. Lleva unos dos minutos.`,
  listConjunction: 'y',
};

const locales: Readonly<Record<string, Locale>> = Object.freeze({ en, es });

/**
 * Devuelve los textos del idioma activo. Acepta tanto `es` como `es-419` o `es-MX`, que es
 * lo que manda el navegador cuando la detección automática está encendida.
 */
export const getFlowCopy = (language: string | undefined): Locale =>
  locales[(language ?? 'en').split('-')[0] ?? 'en'] ?? en;
/* TE:END account-flow */
