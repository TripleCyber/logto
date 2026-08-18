/* TE:BEGIN account-flow */
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { getFlowCopy } from '../copy';
import { useFlowProgress } from '../use-flow-progress';

import styles from './index.module.scss';

type Props = {
  readonly className?: string;
};

/**
 * Qué se va a pedir, en una frase, bajo el título de la primera pantalla.
 *
 * ## Por qué una frase y no una lista
 *
 * La primera versión era una lista con viñetas, una fila por fase. Con tres fases
 * funcionaba; al pasar a cinco se convirtió en diez líneas y en un muro que se leía como
 * "esto va a ser largo" — exactamente lo contrario de lo que buscaba.
 *
 * Una frase con la enumeración da la misma información en dos líneas y suena a persona,
 * no a formulario. El "lleva unos dos minutos" es lo que más tranquiliza: el abandono en
 * un alta viene de no saber cuánto falta.
 *
 * ## Por qué solo en `/register`
 *
 * En `/register/verification-code` el usuario ya está dentro y acaba de pedir un código;
 * repetirle el resumen sería ruido. A partir de ahí orienta la barra de progreso.
 */
const FlowIntro = ({ className }: Props) => {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  const progress = useFlowProgress();

  if (pathname !== '/register' || !progress) {
    return null;
  }

  const copy = getFlowCopy(i18n.language);
  const summaries = progress.steps.map(({ summary }) => summary);

  /*
   * Enumeración con el conector del idioma: "a, b y c". `Intl.ListFormat` sería lo
   * correcto, pero su salida depende del ICU que traiga cada navegador y en un WebView
   * antiguo puede no existir. Con cinco elementos fijos, unirlos a mano es predecible.
   */
  const items =
    summaries.length > 1
      ? `${summaries.slice(0, -1).join(', ')} ${copy.listConjunction} ${summaries.at(-1)}`
      : (summaries[0] ?? '');

  return <p className={classNames(styles.intro, className)}>{copy.whatsNextSentence(items)}</p>;
};

export default FlowIntro;
/* TE:END account-flow */
