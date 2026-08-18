import { type TFuncKey } from 'i18next';
import { useTranslation } from 'react-i18next';

import TeQrCanvas from '../TeQrCanvas';

import styles from './index.module.scss';

/**
 * El último código, velado, y toda su superficie es el botón que pide otro.
 *
 * ## Por qué el código se queda en pantalla
 *
 * Antes, cuando el canal moría, el código desaparecía y quedaba un marco vacío con un texto y un
 * botón pequeño debajo. Un marco vacío no dice nada: no se distingue de una pantalla que todavía
 * está cargando, ni de una que se ha roto. Un código que sigue ahí pero **cubierto** dice las dos
 * cosas que hacen falta a la vez —esto estaba vivo, y se puede revivir— sin gastar ni una línea de
 * explicación.
 *
 * Y el objetivo del clic es el código entero, no un botón debajo. Es lo que la persona está
 * mirando y hacia donde ya lleva el ratón o el dedo; poner el objetivo en otro sitio es pedirle que
 * mire a otro lado para arreglar lo que tiene delante.
 *
 * ## Por qué es un `<button>` de verdad
 *
 * Un `<div onClick>` no lo alcanza el tabulador, no lo anuncia ningún lector y no responde a Enter
 * ni a Espacio: sería dejar la única salida de la pantalla fuera del alcance de quien no usa ratón.
 * Con un `<button>` todo eso viene de fábrica y no hay que reimplementarlo con `tabIndex`,
 * `role="button"` y un `onKeyDown` que siempre se olvida de una tecla.
 *
 * El nombre accesible es el texto de la acción, y el lienzo va dentro de un contenedor
 * `aria-hidden`: el código velado ya no se puede escanear, así que anunciarlo como «código de
 * acceso» mandaría a alguien a apuntar la cámara a algo que no va a funcionar.
 */

type Props = {
  /** Lado del lienzo en píxeles CSS. Lo decide quien maqueta, igual que con el código vivo. */
  readonly lado: number;
  /** El último URI pintado. Se conserva a propósito: el velo tapa un código, no un hueco. */
  readonly uri: string;
  /** Texto corto de la acción. Es también el nombre accesible del botón. */
  readonly accion: TFuncKey;
  readonly onReactivar: () => void;
};

const TeQrVelado = ({ lado, uri, accion, onReactivar }: Props) => {
  const { t } = useTranslation();

  return (
    <button type="button" className={styles.velado} onClick={onReactivar}>
      <span aria-hidden className={styles.codigo}>
        <TeQrCanvas lado={lado} uri={uri} />
      </span>
      <span className={styles.capa}>
        <span className={styles.texto}>{String(t(accion))}</span>
      </span>
    </button>
  );
};

export default TeQrVelado;
