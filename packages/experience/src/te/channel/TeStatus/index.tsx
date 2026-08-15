import { type TFuncKey } from 'i18next';
import { useTranslation } from 'react-i18next';

import styles from '../index.module.scss';
import { type FaseCanal } from '../use-te-channel';

/**
 * Lo que la pantalla dice de sí misma en cada estado.
 *
 * Siete estados y siete frases, todas por i18n. Dos reglas que no son de estilo:
 *
 * 1. **Ningún estado revela si la cuenta existe.** `failed` dice lo mismo para quien tiene
 *    cartera y no aprueba que para quien nunca la vinculó — que es exactamente lo que el servidor
 *    ya garantiza al responder igual en los dos casos. Un texto distinto aquí desharía esa
 *    propiedad desde la capa más barata de leer.
 * 2. **Ningún estado culpa a nadie ni usa jerga.** Nada de «IP», «riesgo» ni «puntuación»: quien
 *    lee esto está atascado y necesita saber qué hacer, no un diagnóstico.
 *
 * `aria-live="polite"` porque el estado cambia solo, sin que la persona toque nada: sin esto,
 * quien usa lector de pantalla se queda esperando en silencio a que pase algo.
 */

type Props = {
  readonly fase: FaseCanal;
  /**
   * En el canal push, `failed` significa además «no se pudo entregar el aviso». El marco es el
   * mismo; lo que cambia es qué le sirve a la persona, que aquí es cambiar de dispositivo.
   */
  readonly canal: 'qr' | 'push';
};

const claves: Readonly<Record<FaseCanal, TFuncKey | undefined>> = Object.freeze({
  inactivo: undefined,
  abriendo: 'te.status.waiting',
  esperando: 'te.status.waiting',
  escaneado: 'te.status.scanned',
  confirmando: 'te.status.approving',
  aprobado: 'te.status.approving',
  rechazado: 'te.status.rejected',
  caducado: 'te.status.expired',
  fallo: 'te.status.failed',
  sinRed: 'te.status.offline',
});

const esFallo = (fase: FaseCanal) =>
  fase === 'rechazado' || fase === 'caducado' || fase === 'fallo' || fase === 'sinRed';

const TeStatus = ({ fase, canal }: Props) => {
  const { t } = useTranslation();
  const clave = claves[fase];

  if (!clave) {
    return null;
  }

  // En push, «esperando» ya no es «esperando a tu cartera» sino «lo hemos enviado, apruébalo».
  const clavePintada: TFuncKey =
    canal === 'push' && (fase === 'esperando' || fase === 'abriendo')
      ? 'te.push.description'
      : clave;

  return (
    <div className={esFallo(fase) ? styles.estadoError : styles.estado} aria-live="polite">
      {String(t(clavePintada))}
    </div>
  );
};

export default TeStatus;
