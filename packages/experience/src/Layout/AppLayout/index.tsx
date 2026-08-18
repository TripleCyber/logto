import classNames from 'classnames';
import { Outlet, useLocation } from 'react-router-dom';

import usePlatform from '@/hooks/use-platform';
import { isRegisterFlowPath } from '@/te/flow/steps'; // TE:account-flow
import { useIsRegisterInteraction } from '@/te/flow/use-is-register-interaction'; // TE:account-flow
import { layoutClassNames } from '@/utils/consts';

import CustomContent from './CustomContent';
import styles from './index.module.scss';

/*
 * TE:BEGIN branding
 *
 * Upstream renderiza aquí <LogtoSignature> ("Powered by Logto") salvo que
 * `experienceSettings.hideLogtoBranding` sea true. Esa opción está capada a Logto Cloud:
 * la Management API la rechaza en OSS con
 * `assertThat(EnvSet.values.isCloud, …)` — ver `core/src/routes/sign-in-experience/index.ts`.
 *
 * Al no poder activarse por configuración, se elimina el componente. Se intentó dejar el
 * condicional nativo intacto forzando la variable, pero dos reglas de eslint se
 * contradicen: `no-unnecessary-condition` rechaza el literal y `no-inferrable-types`
 * rechaza la anotación que lo evitaría.
 *
 * MPL-2.0 no exige atribución en la interfaz; ese gate es comercial, no de licencia.
 *
 * Para revertir: restaurar el import de `LogtoSignature`, `useContext(PageContext)` para
 * obtener `theme` y `experienceSettings`, y el bloque
 * `{!hideLogtoBranding && <LogtoSignature className={…} theme={theme} />}` dentro de <main>.
 *
 * TE:END branding
 */
const AppLayout = () => {
  const { isMobile } = usePlatform();
  /* TE:BEGIN account-flow */
  const { pathname } = useLocation();
  // El hook va en su propia línea: llamarlo dentro de la expresión lo dejaría a merced
  // de una evaluación condicional el día que la línea cambie, y eso rompe las reglas
  // de los hooks de React.
  const isRegisterInteraction = useIsRegisterInteraction();
  const isRegisterFlow = isRegisterFlowPath(pathname, isRegisterInteraction);
  /* TE:END account-flow */

  return (
    <div
      className={classNames(
        styles.viewBox,
        /* TE:BEGIN account-flow */
        isRegisterFlow && 'te-flow-register'
        /* TE:END account-flow */
      )}
    >
      <div className={classNames(styles.container, layoutClassNames.pageContainer)}>
        {!isMobile && <CustomContent className={layoutClassNames.customContent} />}
        <main className={classNames(styles.main, layoutClassNames.mainContent)}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
