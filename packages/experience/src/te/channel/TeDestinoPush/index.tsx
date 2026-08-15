import { type TFuncKey } from 'i18next';
import { useTranslation } from 'react-i18next';

import DeviceIcon from '../TeDevicePicker/DeviceIcon';
import { type DespachoPush } from '../api';
import styles from '../index.module.scss';

/**
 * A dónde fue el aviso.
 *
 * ## Qué se enseña, y qué no
 *
 * Exactamente lo mismo que el selector de dispositivos ya pinta después de un reto fallido, y ni
 * un dato más:
 *
 *  · **un solo destino** → categoría gruesa y antigüedad en cubetas — «Enviado a tu teléfono ·
 *    visto hoy»;
 *  · **varios destinos** (el abanico de PU-11) → sólo cuántos — «Enviado a tus 3 dispositivos».
 *    Sin categoría y sin antigüedad: con el aviso yendo a toda la flota, «teléfono» no describe
 *    el envío sino un aparato concreto de una lista, y esa lista es lo que PU-12 no entrega.
 *
 * **El nombre que la persona le puso a su teléfono no aparece aquí, y no puede.** No es que no se
 * pinte: es que no llega —el tipo que cruza tiene tres claves— y no llegaría aunque el servidor
 * lo mandara, porque en medio hay dos proyecciones con lista blanca. Ese nombre se puede enseñar
 * **después** de aprobar; antes, quien mira esta pantalla es sólo quien tecleó un identificador,
 * y no hay ninguna prueba todavía de que sea su dueño.
 *
 * ## Por qué hay un estado «enviando»
 *
 * Porque durante unos segundos es la verdad. El servidor resuelve el identificador en un
 * trabajador de fondo, fuera del ciclo de petición, para que la latencia de la respuesta no diga
 * si la cuenta existe (PU-4): cuando esta pantalla aparece, el aviso **todavía no ha salido**.
 * Decir «lo hemos enviado a tu teléfono» en ese momento sería mentira, y además una mentira
 * medible — el hueco entre las dos frases es el mismo para una cuenta que existe y para una que
 * no.
 *
 * ## Y por qué esto no delata si la cuenta existe
 *
 * Porque un reto señuelo —identificador que no resuelve, o presupuesto de PU-1 agotado— trae su
 * etiqueta igual, fabricada por el servidor con un HMAC del identificador: mismas claves, mismo
 * alfabeto, mismo momento de aparición y estable entre intentos, igual que lo sería una flota
 * real. Este componente **no distingue los dos casos y no puede**: recibe una etiqueta y la
 * pinta. Si algún día alguien le añadiera una rama que mire de dónde viene, la habría roto.
 */

type Props = {
  /** `undefined` mientras el servidor no ha despachado. Ver arriba: es un estado real. */
  readonly despacho?: DespachoPush;
};

const etiquetaEnviado: Readonly<Record<NonNullable<DespachoPush['kind']>, TFuncKey>> =
  Object.freeze({
    phone: 'te.push.sent_phone',
    tablet: 'te.push.sent_tablet',
    desktop: 'te.push.sent_desktop',
  });

const etiquetaAntiguedad: Readonly<Record<NonNullable<DespachoPush['lastSeen']>, TFuncKey>> =
  Object.freeze({
    today: 'te.push.last_seen_today',
    this_week: 'te.push.last_seen_this_week',
    older: 'te.push.last_seen_older',
  });

const TeDestinoPush = ({ despacho }: Props) => {
  const { t } = useTranslation();

  if (!despacho) {
    return (
      <div className={styles.destino} aria-live="polite">
        {String(t('te.push.sending'))}
      </div>
    );
  }

  if (despacho.count > 1 || !despacho.kind || !despacho.lastSeen) {
    /*
     * El `||` no es defensa contra un tipo mal puesto: es la lectura correcta de «no me han dicho
     * a cuál». Si el servidor manda un número sin categoría, lo honesto es decir el número, no
     * inventarse un teléfono para poder pintar la frase bonita.
     */
    return (
      <div className={styles.destino} aria-live="polite">
        {String(t('te.push.sent_many', { total: despacho.count }))}
      </div>
    );
  }

  return (
    <div className={styles.destino} aria-live="polite">
      <DeviceIcon className={styles.destinoIcono} kind={despacho.kind} />
      <span>
        {String(
          t(etiquetaEnviado[despacho.kind], {
            lastSeen: t(etiquetaAntiguedad[despacho.lastSeen]),
          })
        )}
      </span>
    </div>
  );
};

export default TeDestinoPush;
