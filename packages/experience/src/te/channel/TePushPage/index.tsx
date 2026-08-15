import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SecondaryPageLayout from '@/Layout/SecondaryPageLayout';
import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import ErrorPage from '@/pages/ErrorPage';
import Button from '@/shared/components/Button';

import TeDevicePicker from '../TeDevicePicker';
import TeOtherMethodLink from '../TeOtherMethodLink';
import TeStatus from '../TeStatus';
import styles from '../index.module.scss';
import useTeAvailability from '../use-te-availability';
import useTeChannel from '../use-te-channel';

/**
 * C3 · Aprobar en el móvil.
 *
 * ## El orden importa más que el contenido
 *
 * 1. **Se despacha al dispositivo elegible más reciente sin enseñar ninguna lista.** Cero
 *    información antes de que nadie demuestre nada. El servidor responde exactamente igual
 *    cuando el identificador no resuelve a ningún usuario, así que esta pantalla es idéntica
 *    para quien tiene cartera y para quien no.
 * 2. **La lista sólo aparece después**, cuando el reto ha caducado o ha fallado, o bajo el botón
 *    de «usar otro dispositivo» que aparece entonces. Llegar hasta ahí cuesta un push real en la
 *    pantalla de bloqueo del titular: enumerar deja de ser reconocimiento gratis y pasa a ser un
 *    evento de detección.
 * 3. **«Usar otro método» está siempre a mano**, que es la salida de quien no tenga cartera y no
 *    deba enterarse por esta pantalla de que no la tiene.
 *
 * ## Los dos dígitos
 *
 * Se enseñan aquí y se teclean allí (PU-1). **Nunca tres botones**: elegir entre tres números es
 * 1/3 para quien aprueba a ciegas bajo una lluvia de avisos; teclear dos cifras es 1/100. Y el
 * número **no viaja en la notificación** (PU-9) — está escrito en el texto de la pantalla, porque
 * es la propiedad que hace que mirar el móvil no baste y haya que mirar aquí.
 */
const TePushPage = () => {
  const { t } = useTranslation();
  const { identifierInputValue } = useContext(UserInteractionContext);
  const { hayPush, politicaSelector, resuelto } = useTeAvailability();
  const { fase, huboEscaneo, matchDigits, selectorAbierto, abrirPush, reintentarPush } =
    useTeChannel({
      canal: 'push',
    });

  /**
   * `eager` es un opt-in del tenant y su coste está escrito al lado de la bandera, en el
   * servidor: pinta la lista ANTES del primer despacho, con lo que cualquiera que teclee el
   * identificador de la víctima obtiene el perfil de su flota sin gastar ningún push y sin dejar
   * rastro en su pantalla de bloqueo. Deja de haber evento de detección. Por defecto es `lazy`.
   */
  const [listaPedida, setListaPedida] = useState(false);
  const puedeVersionLista = politicaSelector === 'eager' || selectorAbierto;
  const identificador = identifierInputValue?.value;

  useEffect(() => {
    // El despacho espera a saber que el canal está encendido. Sin esta condición, escribir la URL
    // a mano con el conector apagado sí llegaría a abrir el canal, y la pantalla que dice «sesión
    // inválida» habría gastado un push por el camino.
    if (identificador && hayPush) {
      void abrirPush(identificador);
    }
  }, [identificador, hayPush, abrirPush]);

  if (!resuelto) {
    return null;
  }

  // Sin identificador no hay a quién avisar, y sin canal no hay pantalla.
  if (!identificador || !hayPush) {
    return <ErrorPage title="error.invalid_session" />;
  }

  const terminado = fase === 'rechazado' || fase === 'caducado' || fase === 'fallo';

  return (
    <SecondaryPageLayout description="te.push.description" title="te.push.title">
      <div className={styles.contenedor}>
        {matchDigits && !terminado && (
          <div className={styles.numero}>
            <div className={styles.numeroEtiqueta}>{t('te.push.match_label')}</div>
            <div className={styles.numeroValor}>{matchDigits}</div>
            <div className={styles.numeroPista}>{t('te.push.match_hint')}</div>
          </div>
        )}

        <TeStatus canal="push" fase={fase} hasEscaneo={huboEscaneo} />

        {listaPedida ? (
          <>
            <div className={styles.pista}>{t('te.push.devices_description')}</div>
            <TeDevicePicker
              onElegir={(deviceRef) => {
                setListaPedida(false);
                void reintentarPush(deviceRef);
              }}
            />
          </>
        ) : (
          <div className={styles.acciones}>
            {terminado && (
              <Button
                title="te.action.retry"
                onClick={() => {
                  void reintentarPush();
                }}
              />
            )}
            {puedeVersionLista && (
              <Button
                title="te.push.another_device"
                type="secondary"
                onClick={() => {
                  setListaPedida(true);
                }}
              />
            )}
            <TeOtherMethodLink />
          </div>
        )}
      </div>
    </SecondaryPageLayout>
  );
};

export default TePushPage;
