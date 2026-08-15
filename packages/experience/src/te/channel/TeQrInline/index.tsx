import { useTranslation } from 'react-i18next';

import Divider from '@/components/Divider';
import usePlatform from '@/hooks/use-platform';

import TeQrPanel from '../TeQrPanel';
import styles from '../index.module.scss';
import useTeAvailability from '../use-te-availability';

/**
 * C1 · El QR en «Sign in to your account», **sólo en escritorio**.
 *
 * ## Por qué sólo en escritorio, y por qué esta comprobación y no otra
 *
 * Un QR en la pantalla del móvil no se puede escanear con ese mismo móvil. En móvil el factor
 * existe igual, pero se llega pulsando el botón del conector y se pinta en su propia pantalla
 * (`TeQrPage`).
 *
 * La decisión sale de `usePlatform()`, que es lo que hay que usar aquí y no una media query ni la
 * lectura de `body.mobile` desde React. Motivo concreto: la **vista previa de la consola**
 * sobrescribe `platform` por estado de React (`SettingsProvider/use-preview.ts`), así que una
 * media query ignoraría la previsualización y rompería la reactividad a consola. El tipo
 * `Platform` es `'web' | 'mobile'`; `'web'` es el escritorio.
 *
 * ## Reactividad a consola
 *
 * `useTeAvailability()` mira el conector en `experienceSettings.socialConnectors` —que la consola
 * alimenta y la vista previa sobrescribe— y los interruptores del servidor, que son fail-closed.
 * Apagar el conector en la consola apaga el QR sin desplegar nada, y una caída de te-api tampoco
 * pinta un botón que no va a funcionar.
 */
const TeQrInline = () => {
  const { t } = useTranslation();
  const { platform } = usePlatform();
  const { hayQr } = useTeAvailability();

  if (platform !== 'web' || !hayQr) {
    return null;
  }

  return (
    <div className={styles.incrustado}>
      <Divider label="description.or" />
      <div className={styles.pista}>{t('te.qr.description')}</div>
      {/*
        Sin el enlace de «otro método»: en esta pantalla los otros métodos están justo encima, y
        un enlace que lleva a donde ya estás es ruido.
      */}
      <TeQrPanel hasSalida={false} />
    </div>
  );
};

export default TeQrInline;
