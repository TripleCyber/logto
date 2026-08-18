import type { LanguageTag } from '@logto/language-kit';
import { languages, findSupportedLanguageTag } from '@logto/language-kit';
import type { NormalizeKeyPaths } from '@silverhand/essentials';
import { z } from 'zod';

import ar from './locales/ar/index.js';
import cs from './locales/cs/index.js';
import de from './locales/de/index.js';
import en from './locales/en/index.js';
import es from './locales/es/index.js';
import faIR from './locales/fa-ir/index.js';
import fr from './locales/fr/index.js';
import it from './locales/it/index.js';
import ja from './locales/ja/index.js';
import ko from './locales/ko/index.js';
import plPL from './locales/pl-pl/index.js';
import ptBR from './locales/pt-br/index.js';
import ptPT from './locales/pt-pt/index.js';
import ru from './locales/ru/index.js';
import th from './locales/th/index.js';
import trTR from './locales/tr-tr/index.js';
import ukUA from './locales/uk-ua/index.js';
import zhCN from './locales/zh-cn/index.js';
import zhHK from './locales/zh-hk/index.js';
import zhTW from './locales/zh-tw/index.js';
import type { LocalePhrase } from './types.js';

export type { LocalePhrase } from './types.js';

export type I18nKey = NormalizeKeyPaths<typeof en.translation>;

export const builtInLanguages = [
  'ar',
  'cs',
  'de',
  'en',
  'es',
  'fa-IR',
  'fr',
  'it',
  'ja',
  'ko',
  'pl-PL',
  'pt-PT',
  'pt-BR',
  'ru',
  'th',
  'tr-TR',
  'uk-UA',
  'zh-CN',
  'zh-HK',
  'zh-TW',
] as const;

export const builtInLanguageOptions = builtInLanguages.map((languageTag) => ({
  value: languageTag,
  title: languages[languageTag],
}));

export const builtInLanguageTagGuard = z.enum(builtInLanguages);

export type BuiltInLanguageTag = z.infer<typeof builtInLanguageTagGuard>;

export type Resource = Record<BuiltInLanguageTag, LocalePhrase>;

/**
 * LOGTO PATCH(te-factor-choice): garantiza el grupo `te` en todos los idiomas.
 *
 * `Resource` exige que cada idioma sea un `LocalePhrase` COMPLETO, así que añadir un grupo a
 * `en` —que es de donde sale el tipo— deja a los otros diecinueve sin compilar. Las dos salidas
 * eran duplicar el archivo de textos diecinueve veces, o esto.
 *
 * Se rellena con el inglés y **sólo donde falta**: el propio grupo del idioma va después en el
 * literal, así que un `te` traducido —hoy `es`, mañana los demás— gana siempre. Traducir es
 * trabajo de traducción y no de código; hasta que exista, un texto en inglés se lee y una clave
 * cruda no.
 *
 * Upstream: el mapa `resource` se escribía directamente, sin envolver.
 */
const conTe = <T extends { translation: object }>(locale: T) =>
  Object.freeze({
    ...locale,
    translation: { te: en.translation.te, ...locale.translation },
  });

const resource: Resource = {
  // LOGTO PATCH(te-factor-choice): `conTe` sólo rellena el grupo `te` cuando el idioma no lo trae.
  ar: conTe(ar),
  cs: conTe(cs),
  de: conTe(de),
  en,
  es: conTe(es),
  'fa-IR': conTe(faIR),
  fr: conTe(fr),
  it: conTe(it),
  ja: conTe(ja),
  ko: conTe(ko),
  'pl-PL': conTe(plPL),
  'pt-PT': conTe(ptPT),
  'pt-BR': conTe(ptBR),
  ru: conTe(ru),
  th: conTe(th),
  'tr-TR': conTe(trTR),
  'uk-UA': conTe(ukUA),
  'zh-CN': conTe(zhCN),
  'zh-HK': conTe(zhHK),
  'zh-TW': conTe(zhTW),
};

export const getDefaultLanguageTag = (language: string): LanguageTag =>
  builtInLanguageTagGuard.parse(
    findSupportedLanguageTag(language ? [language] : [], builtInLanguages, 'en')
  );

export const isBuiltInLanguageTag = (language: string): language is BuiltInLanguageTag =>
  builtInLanguageTagGuard.safeParse(language).success;

export default resource;
