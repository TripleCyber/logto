import type { ExperienceSocialConnector } from '@logto/schemas';
import classNames from 'classnames';
import { useState } from 'react';

import SocialLinkButton from '@/components/Button/SocialLinkButton';
import useNativeMessageListener from '@/hooks/use-native-message-listener';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params'; // LOGTO PATCH(te-qr-desktop)
import usePlatform from '@/hooks/use-platform'; // LOGTO PATCH(te-qr-desktop)
import { getLogoUrl } from '@/shared/utils/logo';
import { objetivoConectorTe, rutasTe } from '@/te/channel/config'; // LOGTO PATCH(te-qr-desktop)
import useTeAvailability from '@/te/channel/use-te-availability'; // LOGTO PATCH(te-qr-desktop)

import styles from './index.module.scss';
import useSocial from './use-social';

type Props = {
  readonly className?: string;
  readonly socialConnectors?: ExperienceSocialConnector[];
};

/** LOGTO PATCH(te-qr-desktop): ¿es éste el conector de TripleEnable? Por `target`, nunca por id. */
const esTe = ({ target }: ExperienceSocialConnector) => target === objetivoConectorTe;

const SocialSignInList = ({ className, socialConnectors = [] }: Props) => {
  const { invokeSocialSignIn, theme } = useSocial();
  useNativeMessageListener();

  /*
   * LOGTO PATCH(te-qr-desktop) + LOGTO PATCH(te-register-no-wallet)
   *
   * El filtro va AQUÍ y no en las páginas que llaman a este componente. Es el único componente
   * compartido por las cuatro invocaciones —`SignIn/index.tsx`, `SignIn/Main.tsx` y las dos de
   * `Register/index.tsx`—, así que decidiendo él mismo se impide que quien añada una quinta se
   * olvide del criterio. Una prop no valdría por el mismo motivo: sería opcional.
   *
   * Tres reglas:
   *
   * 1. **C4 · en el alta no se ofrece la cartera.** Todo usuario existe primero en Logto y
   *    después se vincula, así que este conector es de acceso y nunca de creación. La ruta del
   *    canal lo rechaza igual si alguien la llama a mano; esto es que no exista la puerta.
   *    `useTeAvailability()` ya devuelve todo apagado en una interacción de alta.
   * 2. **C1 · en escritorio el botón desaparece**, porque el QR ya está pintado más arriba en la
   *    misma pantalla. Dos entradas al mismo factor a diez centímetros una de otra es ruido.
   * 3. **En móvil el botón se queda y lleva a la pantalla del QR**, en vez de arrancar el
   *    redirect social. Es el único camino al factor en móvil, porque ahí el código no se pinta
   *    en la pantalla principal: un QR en el móvil no se escanea con ese mismo móvil.
   *
   * Upstream: `socialConnectors.map(...)` sin filtro y con `invokeSocialSignIn` para todos.
   */
  const { platform } = usePlatform();
  const { hayQr } = useTeAvailability();
  const navigate = useNavigateWithPreservedSearchParams();
  const conectoresVisibles = socialConnectors.filter(
    (connector) => !esTe(connector) || (platform === 'mobile' && hayQr)
  );
  /* LOGTO PATCH end */

  const [loadingConnectorId, setLoadingConnectorId] = useState<string>();

  const handleClick = async (connector: ExperienceSocialConnector) => {
    /* LOGTO PATCH(te-qr-desktop): el factor vive dentro de la experiencia. No hay redirect. */
    if (esTe(connector)) {
      navigate({ pathname: rutasTe.qr });

      return;
    }
    /* LOGTO PATCH end */

    setLoadingConnectorId(connector.id);
    await invokeSocialSignIn(connector);
    setLoadingConnectorId(undefined);
  };

  return (
    <div className={classNames(styles.socialLinkList, className)}>
      {conectoresVisibles.map((connector) => {
        const { id, name, logo: logoUrl, logoDark: darkLogoUrl, target } = connector;

        return (
          <SocialLinkButton
            key={id}
            className={styles.socialLinkButton}
            name={name}
            logo={getLogoUrl({ theme, logoUrl, darkLogoUrl })}
            target={target}
            isLoading={loadingConnectorId === id}
            onClick={() => {
              void handleClick(connector);
            }}
          />
        );
      })}
    </div>
  );
};

export default SocialSignInList;
