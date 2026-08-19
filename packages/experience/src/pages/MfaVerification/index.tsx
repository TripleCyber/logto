import SecondaryPageLayout from '@/Layout/SecondaryPageLayout';
import MfaFactorList from '@/containers/MfaFactorList';
import useMfaFlowState from '@/hooks/use-mfa-factors-state';
import TePushMfaCard from '@/te/channel/TePushMfaCard'; // LOGTO PATCH(te-push-as-mfa)
import { UserMfaFlow } from '@/types';

import ErrorPage from '../ErrorPage';

import styles from './index.module.scss';

const MfaVerification = () => {
  const flowState = useMfaFlowState();

  if (!flowState) {
    return <ErrorPage title="error.invalid_session" />;
  }

  return (
    <SecondaryPageLayout title="mfa.verify_mfa_factors" description="mfa.verify_mfa_description">
      {/*
        LOGTO PATCH(te-push-as-mfa): aprobar en el teléfono, al lado de los factores del servidor.
        Va DESPUÉS de la lista y no dentro porque no es un `MfaFactor` —ver `TePushMfaCard`—, y
        sólo aparece en la verificación, nunca en la vinculación: no hay nada que vincular, la
        cartera ya se enroló con una firma y una biometría.

        El contenedor existe sólo para el hueco: sin él la tarjeta cae fuera del `gap` de
        `MfaFactorList` y se ve pegada a la última.
      */}
      <div className={styles.opciones}>
        <MfaFactorList flow={UserMfaFlow.MfaVerification} flowState={flowState} />
        <TePushMfaCard />
      </div>
    </SecondaryPageLayout>
  );
};

export default MfaVerification;
