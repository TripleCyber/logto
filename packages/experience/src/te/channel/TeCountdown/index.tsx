import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { crearReloj, fraccion, restanteMs, segundos } from '../clock';
import styles from '../index.module.scss';

/**
 * Cuánto le queda al código antes de renovarse.
 *
 * El instante lo pone el servidor (`displayExpiresAt`), y el reloj de la pantalla va corregido
 * por el desfase medido con la cabecera `Date` (OP-2). Sin esa corrección, un portátil cuarenta
 * segundos adelantado anuncia una caducidad que no ha ocurrido, y la persona vuelve a empezar
 * una y otra vez sin que haya nada roto.
 *
 * La escala de la barra es **lo que quedaba la primera vez que se vio este código**, no una
 * constante del cliente: así la barra sólo puede encogerse y nunca promete más tiempo del que el
 * servidor dijo.
 */

type Props = {
  readonly expiraEn: string;
  readonly correccionReloj: number;
};

const TeCountdown = ({ expiraEn, correccionReloj }: Props) => {
  const { t } = useTranslation();
  const reloj = crearReloj(correccionReloj);
  const escala = useRef(0);
  const [restante, setRestante] = useState(() => restanteMs(expiraEn, reloj.ahora()));

  useEffect(() => {
    const inicial = restanteMs(expiraEn, Date.now() + correccionReloj);
    // eslint-disable-next-line @silverhand/fp/no-mutation
    escala.current = inicial;
    setRestante(inicial);

    const tic = setInterval(() => {
      setRestante(restanteMs(expiraEn, Date.now() + correccionReloj));
    }, 1000);

    return () => {
      clearInterval(tic);
    };
  }, [expiraEn, correccionReloj]);

  return (
    <div className={styles.reloj}>
      {/*
        `aria-hidden` en la barra: es la misma información que el texto de debajo, y anunciarla
        dos veces convierte una espera de treinta segundos en treinta anuncios.
      */}
      <div aria-hidden className={styles.barra}>
        <div
          className={styles.barraRelleno}
          style={{ transform: `scaleX(${fraccion(restante, escala.current)})` }}
        />
      </div>
      {/*
        `aria-live="off"`: el número cambia cada segundo. Anunciarlo taparía todo lo demás.
        Quien use lector de pantalla tiene el estado del canal, que sí se anuncia cuando cambia.
      */}
      <div className={styles.pista} aria-live="off">
        {t('te.qr.refresh_in', { seconds: segundos(restante) })}
      </div>
    </div>
  );
};

export default TeCountdown;
