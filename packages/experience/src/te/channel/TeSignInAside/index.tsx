import classNames from 'classnames';
import { type CSSProperties, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@/shared/components/Button';
import { LoadingIcon } from '@/shared/components/LoadingLayer';

import TeCountdown from '../TeCountdown';
import TeQrCanvas from '../TeQrCanvas';
import TeStatus from '../TeStatus';
import { claseAncla } from '../signin-split';
import useEstaVisible from '../use-esta-visible';
import useTeAvailability from '../use-te-availability';
import useTeChannel from '../use-te-channel';

import styles from './index.module.scss';

/**
 * El lado del código en la columna, en píxeles CSS. Sale de la maqueta.
 *
 * Se decide **aquí y sólo aquí**, y baja al CSS por variable: el `<canvas>` necesita este número
 * para que cada módulo caiga en un número entero de píxeles del dispositivo, así que si el CSS lo
 * decidiera por su cuenta el estilo en línea del lienzo ganaría siempre y la regla quedaría escrita
 * sin hacer nada. De la misma variable cuelgan el ancho de la barra de vida y el del hueco de
 * carga, que por eso no pueden desalinearse con el código.
 */
const ladoAside = 188;

/** React no tipa las propiedades personalizadas de CSS; de ahí la función con la firma correcta. */
const conLado = (lado: number): CSSProperties =>
  Object.fromEntries([['--te-qr-lado', `${lado}px`]]);

/**
 * El marcador: la caja del código, del tamaño exacto que tendrá el código.
 *
 * Se pinta mientras no se sabe si hay factor y mientras la columna no está a la vista. Reserva el
 * hueco para que nada dé un salto cuando llegue el código de verdad, y no promete nada que pueda
 * no cumplirse.
 */
const Marcador = () => (
  <div className={classNames(styles.marco, styles.marcoApagado)}>
    <div className={styles.marcoVacio}>
      <LoadingIcon />
    </div>
  </div>
);

/**
 * El contenido vivo de la columna: el código, su reloj, el emparejamiento y el estado.
 *
 * Está en un componente aparte para que `useTeChannel` **no se monte** hasta que la columna se ve
 * de verdad. Montarlo antes abriría un canal contra te-api y lo sondearía para no enseñar nada:
 * en un móvil, donde la columna está escondida por CSS, eso sería una sesión de servidor y una
 * cadena de peticiones por cada carga de la pantalla de acceso.
 */
const TeSignInAsideCanal = () => {
  const { t } = useTranslation();
  const { fase, huboEscaneo, codigo, pairCode, correccionReloj, abrirQr } = useTeChannel({
    canal: 'qr',
  });

  useEffect(() => {
    void abrirQr();
  }, [abrirQr]);

  /*
   * Los estados de la columna, y lo que cada uno vale:
   *
   * - **esperando** (por defecto, y NO es un error): el código gira y el punto late. Esperar no es
   *   fallar, así que aquí no hay nada rojo ni nada que reintentar.
   * - **escaneado**: el canal en vivo dice que alguien reclamó el código. Se para la cuenta atrás
   *   —la máquina ya ignora los marcos `code` posteriores, así que anunciar una renovación que no
   *   va a ocurrir sólo invita a esperar en vez de a terminar en el móvil— y el texto cambia.
   * - **aprobado / confirmando**: confirmación breve mientras se completa el acceso.
   * - **caducado / sin red / fallo**: sólo entonces, y siempre con el botón de reintento.
   *
   * Lo que NO existe es ningún camino que pinte un fallo antes de que el canal haya avisado de un
   * escaneo. Del texto se encarga `TeStatus` con `hasEscaneo`; de la forma, esto: la caja del
   * código no desaparece nunca —se queda como marcador— y debajo aparece el reintento.
   */
  const terminado = fase === 'rechazado' || fase === 'caducado' || fase === 'fallo';
  const rotando = fase === 'abriendo' || fase === 'esperando';
  const hayCodigo = Boolean(codigo) && !terminado;

  return (
    <>
      <div className={classNames(styles.marco, !hayCodigo && styles.marcoApagado)}>
        {hayCodigo && codigo ? (
          <TeQrCanvas lado={ladoAside} uri={codigo.uri} />
        ) : (
          <div className={styles.marcoVacio}>{terminado ? undefined : <LoadingIcon />}</div>
        )}
      </div>

      {/*
        La vida del código va DEBAJO del código y nunca encima: taparlo con su propio reloj es
        impedir justo lo que se pide hacer.
      */}
      {rotando && codigo && (
        <div className={styles.reloj}>
          <TeCountdown correccionReloj={correccionReloj} expiraEn={codigo.displayExpiresAt} />
        </div>
      )}

      {/*
        El número de emparejamiento (RL-1) no está en la maqueta y aun así se queda: es lo que
        impide que un relay de espejo pinte el código de otra sesión, y esta columna es ahora la
        puerta principal del factor. Se enseña más pequeño que en la pantalla propia porque aquí
        compite por 284 px de ancho y no por la pantalla entera.
      */}
      {!terminado && pairCode && (
        <div className={styles.numero}>
          <div className={styles.numeroEtiqueta}>{t('te.qr.pair_code_label')}</div>
          <div className={styles.numeroValor}>{pairCode}</div>
        </div>
      )}

      <div className={styles.espera}>
        {/*
          El punto latiendo dice «esto está vivo» sin gastar una línea de texto, y por eso late
          mientras el canal lo esté — también con el código ya reclamado, que es justo cuando la
          persona está mirando el móvil y volviendo aquí a ver si pasó algo. Sólo se apaga en los
          terminales, donde ya no queda nada que esperar y lo que hay es un botón.
        */}
        {!terminado && <i aria-hidden className={styles.pulso} />}
        <TeStatus canal="qr" fase={fase} hasEscaneo={huboEscaneo} />
      </div>

      {terminado && (
        <Button
          size="small"
          className={styles.reintento}
          title="te.action.retry"
          onClick={() => {
            void abrirQr();
          }}
        />
      )}
    </>
  );
};

/**
 * C1 · La columna del código en la tarjeta de acceso.
 *
 * ## Por qué una columna y no una fila más
 *
 * El QR **no necesita saber quién eres**. Ése es el motivo entero: cualquier otra forma de entrar
 * empieza por teclear un identificador, y ésta empieza y termina en el teléfono. Así que en
 * escritorio se enseña encendido y a la izquierda: hay sitio, y un código que ya está girando se
 * escanea sin tener que decidir nada antes.
 *
 * **Cuando no caben las dos columnas, el QR no se encoge —un QR pequeño es un QR que no se
 * escanea—: se convierte en la primera fila, que lleva a su pantalla.** Esa fila es el botón del
 * conector social, que ahora sigue existiendo también en escritorio: quien tenga la ventana
 * estrecha, o prefiera la pantalla completa, tiene que poder llegar igual.
 *
 * ## El interruptor escritorio/móvil es CSS, no JavaScript
 *
 * La rama anterior lo decidía con `usePlatform()`. Ahora lo decide `@media (min-width: 820px)`, y
 * es mejor por tres motivos concretos: no hay salto al hidratar, responde al **tamaño real de la
 * ventana** en vez de a lo que diga un user-agent, y una ventana de escritorio estrecha se comporta
 * como debe sin ningún truco. La vista previa de la consola tampoco sufre: previsualizar «móvil»
 * estrecha el marco, y una media query mide justo eso.
 *
 * Queda un JavaScript, y es de otra cosa: `useEstaVisible` **observa** el nodo para saber si el
 * CSS lo ha pintado, y sólo entonces se abre el canal. No repite la media query —la lee— y existe
 * porque una columna escondida sigue montada: sin esto, cada carga en un móvil abriría una sesión
 * contra te-api para no enseñar nada.
 *
 * `te/theme/signin-split.scss` engancha el ancho de la tarjeta a la **presencia de este nodo**, así
 * que el hueco y la columna aparecen y desaparecen juntos y no puede quedar una columna vacía.
 *
 * ## Reactividad a consola
 *
 * `useTeAvailability()` mira el conector en `experienceSettings.socialConnectors` —que la consola
 * alimenta y la vista previa sobrescribe— y los interruptores del servidor, que son fail-closed.
 * Apagar el conector en la consola quita la columna Y la fila sin desplegar nada, y una caída de
 * te-api tampoco pinta un código que no va a funcionar.
 */
const TeSignInAside = () => {
  const { t } = useTranslation();
  const { hayQr, resuelto } = useTeAvailability();
  const { ref, estaVisible } = useEstaVisible<HTMLElement>();

  /*
   * Resuelto y sin factor: ni columna, ni hueco, ni tarjeta ancha. Mientras no se sabe, el hueco se
   * queda: si aquí se devolviera `null`, la tarjeta encogería de 860 a 540 px en cuanto llegara la
   * respuesta, y ese salto delante de quien ya estaba leyendo el formulario es peor que unas
   * centésimas de marcador.
   */
  if (resuelto && !hayQr) {
    return null;
  }

  return (
    <aside ref={ref} className={classNames(styles.aside, claseAncla)} style={conLado(ladoAside)}>
      <h2 className={styles.titulo}>{t('te.qr.aside_title')}</h2>
      <p className={styles.nota}>{t('te.qr.aside_note')}</p>

      {hayQr && estaVisible ? <TeSignInAsideCanal /> : <Marcador />}
    </aside>
  );
};

export default TeSignInAside;
