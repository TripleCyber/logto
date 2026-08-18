import { type TFuncKey } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadingIcon } from '@/shared/components/LoadingLayer';

import { listarDispositivos, type DispositivoEnmascarado } from '../api';
import { topeDispositivos } from '../config';
import styles from '../index.module.scss';

import DeviceIcon from './DeviceIcon';

/**
 * C3 · La lista de dispositivos, enmascarada.
 *
 * ## Lo que este componente NO hace, y por qué es lo importante
 *
 * **No reordena y no deduplica.** El orden por más reciente y la ausencia de repetidos son
 * garantías del servidor: un índice único por instalación y una cláusula de elegibilidad dentro
 * de la consulta. Si la UI reordenara «por si acaso», un fallo del servidor —el mismo aparato
 * dos veces, o un revocado colándose— se vería perfecto en pantalla y nadie se enteraría nunca.
 * Tapar un fallo del servidor desde el cliente es la peor forma de arreglarlo.
 *
 * **No pinta nada que no venga enmascarado.** Lo que llega tiene tres claves y sólo tres:
 * `deviceRef` opaco, categoría gruesa y antigüedad en cubetas. Ni nombres puestos por el usuario,
 * ni modelos, ni versiones de sistema, ni marcas de tiempo. El nombre real se puede enseñar
 * **después** de aprobar, no antes.
 *
 * ## Por qué la lista está cerrada hasta que algo falla (PU-12)
 *
 * Un selector de dispositivos antes de autenticar es un oráculo de inventario: quien teclee el
 * correo de la víctima vería su flota. La mitigación es de orden, no de contenido: por defecto se
 * despacha al más reciente sin enseñar nada, y la lista sólo se abre después de que un reto real
 * haya caducado o fallado. Llegar hasta aquí cuesta un push de verdad en la pantalla de bloqueo
 * del titular, que convierte enumerar en un evento de detección.
 *
 * El servidor es quien impone eso; este componente ni siquiera puede pedir la lista antes, porque
 * la ruta responde el error uniforme. El tope de cinco se aplica también aquí, como cinturón.
 */

type Props = {
  readonly onElegir: (deviceRef: string) => void;
};

const etiquetaCategoria: Readonly<Record<DispositivoEnmascarado['kind'], TFuncKey>> = Object.freeze(
  {
    phone: 'te.push.device_phone',
    tablet: 'te.push.device_tablet',
    desktop: 'te.push.device_desktop',
  }
);

const etiquetaAntiguedad: Readonly<Record<DispositivoEnmascarado['lastSeen'], TFuncKey>> =
  Object.freeze({
    today: 'te.push.last_seen_today',
    this_week: 'te.push.last_seen_this_week',
    older: 'te.push.last_seen_older',
  });

const TeDevicePicker = ({ onElegir }: Props) => {
  const { t } = useTranslation();
  const [dispositivos, setDispositivos] = useState<readonly DispositivoEnmascarado[]>();
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    // Guardia de cancelación en una variable del efecto, no en una `ref`: una `ref` compartida
    // entre ejecuciones se apaga en la limpieza de la anterior justo cuando la siguiente la
    // acaba de encender.
    // eslint-disable-next-line @silverhand/fp/no-let
    let vigente = true;

    const cargar = async () => {
      try {
        const { devices } = await listarDispositivos();

        if (vigente) {
          setDispositivos(devices);
        }
      } catch {
        if (vigente) {
          setFallo(true);
        }
      }
    };

    void cargar();

    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      vigente = false;
    };
  }, []);

  if (fallo) {
    // El mismo error uniforme que cualquier otro fallo del canal. Decir «esta cuenta no tiene
    // dispositivos» sería justo el oráculo que todo lo anterior evita.
    return <div className={styles.estadoError}>{t('te.status.failed')}</div>;
  }

  if (!dispositivos) {
    return (
      <div className={styles.acciones}>
        <LoadingIcon />
      </div>
    );
  }

  return (
    <div className={styles.dispositivos}>
      {dispositivos.slice(0, topeDispositivos).map((dispositivo) => (
        <button
          key={dispositivo.deviceRef}
          type="button"
          className={styles.dispositivo}
          onClick={() => {
            onElegir(dispositivo.deviceRef);
          }}
        >
          <DeviceIcon className={styles.dispositivoIcono} kind={dispositivo.kind} />
          <span>
            {t('te.push.device_option', {
              kind: t(etiquetaCategoria[dispositivo.kind]),
              lastSeen: t(etiquetaAntiguedad[dispositivo.lastSeen]),
            })}
          </span>
        </button>
      ))}
    </div>
  );
};

export default TeDevicePicker;
