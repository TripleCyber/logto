import { type CSSProperties, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import usePlatform from '@/hooks/use-platform';
import Button from '@/shared/components/Button';
import { LoadingIcon } from '@/shared/components/LoadingLayer';

import TeCountdown from '../TeCountdown';
import TeOtherMethodLink from '../TeOtherMethodLink';
import TeQrCanvas from '../TeQrCanvas';
import TeStatus from '../TeStatus';
import styles from '../index.module.scss';
import useTeChannel from '../use-te-channel';

/**
 * El cuerpo del canal QR: el código, su cuenta atrás, el número de emparejamiento y el estado.
 *
 * Vive en un componente propio porque se pinta en dos sitios distintos y **tiene que ser el
 * mismo** en los dos: incrustado en «Sign in to your account» en escritorio (C1) y en su propia
 * pantalla de factor en móvil (C1 otra vez, por el otro lado). Dos copias se habrían separado en
 * la primera corrección que alguien hiciera en una sola.
 */

type Props = {
  /** El QR incrustado en la primera pantalla no lleva el enlace de «otro método»: ya está ahí. */
  readonly hasSalida?: boolean;
};

/**
 * El lado del código, en píxeles CSS. En la mano hace falta más superficie para que la cámara
 * enganche a la distancia a la que uno sostiene el teléfono; en un monitor, 200 sobran.
 *
 * Se decide **aquí y sólo aquí**, y baja al CSS por variable: el `<canvas>` necesita este número
 * para que cada módulo caiga en un número entero de píxeles del dispositivo, así que si el CSS lo
 * decidiera por su cuenta, el estilo en línea del lienzo ganaría siempre y la regla quedaría
 * escrita sin hacer nada.
 */
const ladoEscritorio = 200;
const ladoMovil = 232;

/**
 * React no tipa las propiedades personalizadas de CSS, así que la variable se construye en una
 * función con la firma correcta en vez de a base de aserciones en el JSX.
 */
const conLado = (lado: number): CSSProperties =>
  Object.fromEntries([['--te-qr-lado', `${lado}px`]]);

const TeQrPanel = ({ hasSalida = true }: Props) => {
  const { t } = useTranslation();
  const { isMobile } = usePlatform();
  const { fase, codigo, pairCode, correccionReloj, abrirQr } = useTeChannel({ canal: 'qr' });
  const lado = isMobile ? ladoMovil : ladoEscritorio;

  useEffect(() => {
    void abrirQr();
  }, [abrirQr]);

  const terminado = fase === 'rechazado' || fase === 'caducado' || fase === 'fallo';

  return (
    <div className={styles.contenedor} style={conLado(lado)}>
      {!terminado && (
        <div className={styles.marco}>
          {codigo ? (
            <TeQrCanvas lado={lado} uri={codigo.uri} />
          ) : (
            <div className={styles.marcoVacio}>
              <LoadingIcon />
            </div>
          )}
        </div>
      )}

      {!terminado && codigo && (
        <TeCountdown correccionReloj={correccionReloj} expiraEn={codigo.displayExpiresAt} />
      )}

      {/*
        El número de emparejamiento (RL-1). Se deriva en esta pestaña a partir del verifier, que
        nunca salió de aquí: por eso un servidor comprometido no puede inventar un número que
        haga coincidir las dos pantallas. Lo que NO hace es detener el relay de espejo — quien
        monta el cebo obtiene el suyo y lo pinta. Necesario y no suficiente.
      */}
      {!terminado && pairCode && (
        <div className={styles.numero}>
          <div className={styles.numeroEtiqueta}>{t('te.qr.pair_code_label')}</div>
          <div className={styles.numeroValor}>{pairCode}</div>
          <div className={styles.numeroPista}>{t('te.qr.pair_code_hint')}</div>
        </div>
      )}

      <TeStatus canal="qr" fase={fase} />

      {!terminado && <div className={styles.pista}>{t('te.qr.no_camera')}</div>}

      {terminado && (
        <div className={styles.acciones}>
          <Button
            title="te.action.retry"
            onClick={() => {
              void abrirQr();
            }}
          />
          {hasSalida && <TeOtherMethodLink />}
        </div>
      )}

      {!terminado && hasSalida && <TeOtherMethodLink />}
    </div>
  );
};

export default TeQrPanel;
