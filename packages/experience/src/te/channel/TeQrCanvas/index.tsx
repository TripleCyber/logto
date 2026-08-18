import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from '../index.module.scss';
import { codificar, dibujar } from '../qr-code';

/**
 * El código, pintado en un `<canvas>`.
 *
 * **Por qué no una `<img src="data:image/png;…">`**, que es lo que hacía la rama previa: eso
 * obliga a abrir `img-src data:` en la política de contenido de la experiencia. La página
 * original de te-api dibujaba en `<canvas>` precisamente para no abrir esa rendija, y perderla
 * aquí habría sido una regresión de una línea que nadie habría revisado.
 *
 * El símbolo se calcula en el navegador a partir del URI que manda el servidor: no viaja ninguna
 * imagen, así que tampoco hay nada que un intermediario pueda sustituir por otra.
 */

type Props = {
  /** El contenido que lee la cartera. Lo construye el servidor. */
  readonly uri: string;
  /** Lado del lienzo en píxeles CSS. Lo decide `TeQrPanel`, que es quien conoce la plataforma. */
  readonly lado: number;
};

const TeQrCanvas = ({ uri, lado }: Props) => {
  const { t } = useTranslation();
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const elemento = lienzo.current;

    if (!elemento) {
      return;
    }

    const simbolo = codificar(uri);
    // Zona de silencio: cuatro módulos por lado, que es lo que exige la norma. Sin ella, un
    // lector con el código pegado al borde de la pantalla falla y nadie sabe por qué.
    const silencio = 4;
    const modulos = simbolo.tamano + silencio * 2;

    /*
     * El lado en píxeles se redondea a un múltiplo entero del número de módulos, y sólo después
     * se escala por `devicePixelRatio`. Si cada módulo no cae en un número entero de píxeles del
     * dispositivo, el navegador reparte el sobrante y unos módulos salen un píxel más anchos que
     * otros: el símbolo se ve bien y los lectores baratos fallan.
     */
    const ratio = window.devicePixelRatio || 1;
    const porModulo = Math.max(1, Math.floor((lado * ratio) / modulos));
    const pixeles = porModulo * modulos;

    // eslint-disable-next-line @silverhand/fp/no-mutation
    elemento.width = pixeles;
    // eslint-disable-next-line @silverhand/fp/no-mutation
    elemento.height = pixeles;

    const contexto = elemento.getContext('2d');

    if (!contexto) {
      return;
    }

    dibujar(contexto, simbolo, porModulo, silencio);
  }, [uri, lado]);

  return (
    <canvas
      ref={lienzo}
      className={styles.lienzo}
      /*
       * Alternativa textual. Un `<canvas>` sin `role="img"` y sin nombre accesible es un agujero
       * para quien usa lector de pantalla: no anuncia nada. El texto no describe el dibujo —eso
       * no ayudaría a nadie— sino qué es y qué hacer con él, y la pantalla ofrece además la vía
       * sin cámara (`te.qr.no_camera`).
       */
      role="img"
      aria-label={t('te.qr.alt')}
    />
  );
};

export default TeQrCanvas;
