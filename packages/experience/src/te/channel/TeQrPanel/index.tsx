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
 * El cuerpo del canal QR **en su propia pantalla** (`TeQrPage`): el código a tamaño de mano, su
 * cuenta atrás, el número de emparejamiento y el estado.
 *
 * ## Por qué la columna del acceso ya no usa esto
 *
 * Antes se pintaba también incrustado bajo el formulario de «Sign in to your account». Ese sitio
 * ya no existe: en el acceso el código vive en la columna de la tarjeta (`TeSignInAside`), que no
 * es este componente con otro margen sino otra composición —título, nota, sin enlace de «otro
 * método», sin la pista de «¿no puedes escanear?» porque el propio formulario está al lado—.
 *
 * Lo que sí comparten, que es lo que importaba, es el **motor**: `useTeChannel` y las mismas
 * piezas (`TeQrCanvas`, `TeCountdown`, `TeStatus`). Dos pantallas con dos máquinas distintas se
 * habrían separado a la primera corrección; dos maquetaciones sobre la misma máquina, no.
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
  const { fase, huboEscaneo, codigo, pairCode, correccionReloj, abrirQr } = useTeChannel({
    canal: 'qr',
  });
  const lado = isMobile ? ladoMovil : ladoEscritorio;

  useEffect(() => {
    void abrirQr();
  }, [abrirQr]);

  const terminado = fase === 'rechazado' || fase === 'caducado' || fase === 'fallo';

  /*
   * La cuenta atrás desaparece en cuanto el canal dice que el código ya está reclamado. La
   * rotación de verdad ya estaba parada —la máquina ignora los marcos `code` posteriores a
   * `escaneado`—, así que lo único que quedaba era un reloj corriendo hacia una renovación que
   * no iba a ocurrir. Un código ya cogido que anuncia que va a cambiar invita a esperar a que
   * cambie en vez de a terminar en el móvil, que es lo que toca.
   */
  const rotando = fase === 'abriendo' || fase === 'esperando';

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

      {rotando && codigo && (
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

      <TeStatus canal="qr" fase={fase} hasEscaneo={huboEscaneo} />

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
