import { type DispositivoEnmascarado } from '../api';

/**
 * El icono de la categoría del dispositivo.
 *
 * Tres siluetas y nada más. El icono dice **exactamente lo mismo** que la etiqueta de al lado y
 * ni un dato más: no hay logotipo de fabricante ni de sistema operativo. Un icono de manzana o de
 * androide en esta lista devolvería, dibujado, parte del inventario que el enmascarado quita del
 * texto — y sería un dato que ninguna traducción ni ninguna revisión de copy volvería a mirar.
 *
 * `aria-hidden` porque la etiqueta ya lo dice: anunciarlo dos veces sólo alarga la lectura.
 */

type Props = {
  readonly kind: DispositivoEnmascarado['kind'];
  readonly className?: string;
};

const DeviceIcon = ({ kind, className }: Props) => {
  if (kind === 'desktop') {
    return (
      <svg aria-hidden className={className} width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect
          x="2"
          y="3.5"
          width="16"
          height="10.5"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M7 17h6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      </svg>
    );
  }

  // Teléfono y tableta comparten forma y sólo cambian de proporción: es la diferencia real entre
  // los dos y la única que la etiqueta promete.
  const ancho = kind === 'tablet' ? 12 : 9;

  return (
    <svg aria-hidden className={className} width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect
        x={(20 - ancho) / 2}
        y="2"
        width={ancho}
        height="16"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M10 15.2h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
};

export default DeviceIcon;
