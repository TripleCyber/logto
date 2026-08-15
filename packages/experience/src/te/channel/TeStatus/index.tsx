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
 *
 * ## Y una tercera, añadida después de verla en producción
 *
 * 3. **Nada de fallos prematuros.** «No se ha confirmado el acceso» habla de un intento que
 *    ocurrió. Antes de que el canal en vivo avise de un escaneo no hay intento: lo que hay es
 *    alguien mirando un código que no ha tocado, y decirle que su acceso falló le hace concluir
 *    que esto está roto. Un canal que se cae, uno que no llega a abrirse o un techo de sesión
 *    agotado son todos «este código no sirve, pide otro» — retriables y sin culpa. Sólo cuando
 *    `hasEscaneo` es cierto se puede hablar de un acceso que no se confirmó.
 */

type Props = {
  readonly fase: FaseCanal;
  /**
   * En el canal push, `failed` significa además «no se pudo entregar el aviso». El marco es el
   * mismo; lo que cambia es qué le sirve a la persona, que aquí es cambiar de dispositivo.
   */
  readonly canal: 'qr' | 'push';
  /**
   * ¿Ha dicho el canal en vivo que alguien cogió el código? Lo calcula `useTeChannel`. No lleva
   * valor por defecto a propósito: quien pinte un estado tiene que haberse hecho la pregunta.
   *
   * El nombre lleva el prefijo `has` porque la casa lo exige a las propiedades booleanas
   * (`react/boolean-prop-naming`, igual que `hasSalida` en `TeQrPanel`); dentro del hook, donde
   * no aplica, se llama `huboEscaneo`.
   */
  readonly hasEscaneo: boolean;
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
  /**
   * LOGTO PATCH(te-canal-revive): el login caducado tiene su propia frase porque tiene su propia
   * salida. Contarlo como un canal muerto mandaba a pedir otro código, y pedir otro código exige
   * una interacción que ya no existe: era mandar a pulsar un botón incapaz de funcionar.
   */
  sesionCaducada: 'te.status.session_expired',
});

/**
 * ¿Se pinta en rojo? Sólo lo que de verdad salió mal.
 *
 * `caducado` y `sinRed` **no** entran: un código que se agotó y una red que se cayó son cosas
 * que pasan solas y que se arreglan con el botón de al lado. Pintarlas de rojo enseña un error a
 * quien no cometió ninguno, que es justo lo que se quiere quitar de esta pantalla.
 */
const esFallo = (fase: FaseCanal, hasEscaneo: boolean) =>
  fase === 'rechazado' || (fase === 'fallo' && hasEscaneo);
// `sesionCaducada` tampoco: que el reloj del login se agote no es culpa de nadie y se arregla con
// el enlace de al lado, igual que `caducado`.

const TeStatus = ({ fase, canal, hasEscaneo }: Props) => {
  const { t } = useTranslation();
  const clave = claves[fase];

  if (!clave) {
    return null;
  }

  // En push, «esperando» ya no es «esperando a tu cartera» sino «lo hemos enviado, apruébalo».
  const clavePush =
    canal === 'push' && (fase === 'esperando' || fase === 'abriendo')
      ? 'te.push.description'
      : clave;

  // Regla 3: sin escaneo no hubo intento, así que no puede haber un intento fallido.
  const clavePintada: TFuncKey =
    fase === 'fallo' && !hasEscaneo ? 'te.status.unavailable' : clavePush;

  return (
    <div
      className={esFallo(fase, hasEscaneo) ? styles.estadoError : styles.estado}
      aria-live="polite"
    >
      {String(t(clavePintada))}
    </div>
  );
};

export default TeStatus;
