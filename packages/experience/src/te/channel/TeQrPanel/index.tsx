import classNames from 'classnames';
import { type TFuncKey } from 'i18next';
import { type CSSProperties, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import usePlatform from '@/hooks/use-platform';
import Button from '@/shared/components/Button';
import { LoadingIcon } from '@/shared/components/LoadingLayer';

import TeCountdown from '../TeCountdown';
import TeOtherMethodLink from '../TeOtherMethodLink';
import TeQrCanvas from '../TeQrCanvas';
import TeQrVelado from '../TeQrVelado';
import TeStatus from '../TeStatus';
import styles from '../index.module.scss';
import { type CodigoCanal } from '../machine';
import { reiniciarAcceso } from '../reinicio';
import { accionDelVelo, canalMuerto, hayReintento, pideEmpezarDeNuevo } from '../superficie';
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

/**
 * El marco del código: vivo, velado o vacío.
 *
 * Está aparte por una razón que no es de estilo: son las tres formas de la misma caja, y tenerlas
 * juntas es lo que hace evidente que **el hueco mide siempre lo mismo** —el marco no da un salto al
 * pasar de una a otra— y que el marco no desaparece nunca, que era lo que hacía la versión
 * anterior al morir el canal.
 */
const Marco = ({
  codigo,
  lado,
  velado,
  velo,
}: {
  readonly codigo?: CodigoCanal;
  readonly lado: number;
  readonly velado?: CodigoCanal;
  readonly velo: { readonly clave: TFuncKey; readonly ejecutar: () => void };
}) => (
  <div className={classNames(styles.marco, !codigo && styles.marcoApagado)}>
    {velado && (
      <TeQrVelado accion={velo.clave} lado={lado} uri={velado.uri} onReactivar={velo.ejecutar} />
    )}

    {!velado && codigo && <TeQrCanvas lado={lado} uri={codigo.uri} />}

    {!codigo && (
      <div className={styles.marcoVacio}>
        <LoadingIcon />
      </div>
    )}
  </div>
);

const TeQrPanel = ({ hasSalida = true }: Props) => {
  const { t } = useTranslation();
  const { isMobile } = usePlatform();
  const { fase, huboEscaneo, codigo, pairCode, correccionReloj, abrirQr, reintentar } =
    useTeChannel({
      canal: 'qr',
    });
  const lado = isMobile ? ladoMovil : ladoEscritorio;

  /*
   * **Al montarse, código nuevo. Siempre, y venga de donde venga.**
   *
   * Entrar a una pantalla de factor por decisión propia es pedir un código, no heredar el que otra
   * superficie dejó agotado. Y no hereda nada por construcción: `useTeChannel` es una instancia
   * nueva por montaje, así que su fase arranca en `inactivo` y esta llamada la lleva a `abriendo`.
   * Lo que sí se heredaba —y era el fallo que se veía como «se abre ya rota»— es que la interacción
   * de Logto estuviera caducada: entonces esta apertura también fallaba, al instante, y la pantalla
   * nacía pidiendo un reintento imposible. Ahora eso tiene nombre propio (`sesionCaducada`) y su
   * propia salida.
   *
   * Lo contrario —abrir un canal por cada render— lo impide el propio `useEffect`: `abrirQr` es
   * estable, así que corre una vez por montaje. Y dentro del hook, la generación garantiza que dos
   * aperturas seguidas dejen viva una sola cadena de sondeo, que es la propiedad que el
   * `IntersectionObserver` de la columna protege desde el otro lado —no montar el canal hasta que
   * la columna se ve— y que aquí no aplica porque esta pantalla siempre se ve.
   */
  useEffect(() => {
    void abrirQr();
  }, [abrirQr]);

  const muerto = canalMuerto(fase);
  /* El velo tapa un código, nunca un hueco: si no llegó a pintarse ninguno, no hay nada que velar. */
  const velado = muerto ? codigo : undefined;
  const velo = accionDelVelo(fase, reintentar);

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
      {/*
        El marco NO desaparece al morir el canal, que es lo que hacía antes: quitarlo dejaba un
        texto y un botón flotando donde había un código, y esa pantalla no se distingue de una que
        se ha roto. Ahora el último código se queda pintado bajo un velo, y el velo entero es el
        botón que pide otro (`TeQrVelado`).

        El blanco es para el código: sin código —abriendo el canal, o ya reclamado— el marco se
        apaga y deja el contorno. Ver la hoja: una lámina blanca vacía parece algo roto.
      */}
      {(!muerto || Boolean(velado)) && (
        <Marco codigo={codigo} lado={lado} velado={velado} velo={velo} />
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
      {!muerto && pairCode && (
        <div className={styles.numero}>
          <div className={styles.numeroEtiqueta}>{t('te.qr.pair_code_label')}</div>
          <div className={styles.numeroValor}>{pairCode}</div>
          <div className={styles.numeroPista}>{t('te.qr.pair_code_hint')}</div>
        </div>
      )}

      <TeStatus canal="qr" fase={fase} hasEscaneo={huboEscaneo} />

      {!muerto && <div className={styles.pista}>{t('te.qr.no_camera')}</div>}

      {/* `sinRed` también trae botón: ver `superficie.ts`. */}
      {hayReintento(fase) && (
        <div className={styles.acciones}>
          <Button
            title="te.action.retry"
            onClick={() => {
              void reintentar();
            }}
          />
          {hasSalida && <TeOtherMethodLink />}
        </div>
      )}

      {pideEmpezarDeNuevo(fase) && (
        <div className={styles.acciones}>
          <Button title="te.action.restart" onClick={reiniciarAcceso} />
          {hasSalida && <TeOtherMethodLink />}
        </div>
      )}

      {!muerto && fase !== 'sinRed' && hasSalida && <TeOtherMethodLink />}
    </div>
  );
};

export default TeQrPanel;
