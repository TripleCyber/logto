/* TE:BEGIN account-flow */
import classNames from 'classnames';

import { useFlowProgress } from '../use-flow-progress';

import styles from './index.module.scss';

type Props = {
  readonly className?: string;
};

/**
 * Indicador de progreso del alta.
 *
 * ## Por qué esta forma y no la anterior
 *
 * La primera versión eran tres segmentos anchos con su etiqueta debajo: ocupaba unos
 * 50 px de alto y competía con el título por la atención. En una tarjeta de 420 px eso es
 * mucho para un elemento que solo orienta.
 *
 * Ahora es una sola línea: un rótulo pequeño en versalitas con la fase y la posición, y
 * bajo él una barra de 2 px partida en tantos tramos como fases. Unos 26 px en total, y
 * la jerarquía queda clara — el rótulo es cromo, el título es el contenido.
 *
 * El texto dice fase Y posición ("Perfil · paso 2 de 3") en lugar de solo una de las dos:
 * la fase sin el número no dice cuánto falta, y el número sin la fase no dice de qué va.
 *
 * ## Accesibilidad
 *
 * El conjunto es un `progressbar` con su valor. El rótulo visible se marca `aria-hidden`
 * porque el `aria-label` ya lo dice completo, y los tramos también: un lector de pantalla
 * anuncia una frase, no tres segmentos anónimos.
 */
const FlowProgress = ({ className }: Props) => {
  const progress = useFlowProgress();

  if (!progress) {
    return null;
  }

  const { steps, currentIndex, ariaLabel, caption } = progress;

  return (
    <div
      className={classNames(styles.progress, className)}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={currentIndex}
      aria-valuemin={1}
      aria-valuemax={steps.length}
    >
      <span aria-hidden className={styles.caption}>
        {caption}
      </span>
      <span aria-hidden className={styles.track}>
        {steps.map(({ phase, isCurrent, isDone }) => (
          <span
            key={phase}
            className={classNames(
              styles.segment,
              isDone && styles.done,
              isCurrent && styles.current
            )}
          />
        ))}
      </span>
    </div>
  );
};

export default FlowProgress;
/* TE:END account-flow */
