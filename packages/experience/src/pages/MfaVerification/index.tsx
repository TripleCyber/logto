import SecondaryPageLayout from '@/Layout/SecondaryPageLayout';
import MfaFactorList from '@/containers/MfaFactorList';
import useMfaFlowState from '@/hooks/use-mfa-factors-state';
import TePushMfaCard from '@/te/channel/TePushMfaCard'; // LOGTO PATCH(te-push-as-mfa)
import { UserMfaFlow } from '@/types';

import ErrorPage from '../ErrorPage';

const MfaVerification = () => {
  const flowState = useMfaFlowState();

  if (!flowState) {
    return <ErrorPage title="error.invalid_session" />;
  }

  return (
    <SecondaryPageLayout title="mfa.verify_mfa_factors" description="mfa.verify_mfa_description">
      <MfaFactorList flow={UserMfaFlow.MfaVerification} flowState={flowState} />
      {/*
        LOGTO PATCH(te-push-as-mfa): aprobar en el teléfono, al lado de los factores del servidor.
        Va DESPUÉS de la lista y no dentro porque no es un `MfaFactor` —ver `TePushMfaCard`—, y
        sólo aparece en la verificación, nunca en la vinculación: no hay nada que vincular, la
        cartera ya se enroló con una firma y una biometría.
      */}
      <TePushMfaCard />
    </SecondaryPageLayout>
  );
};

export default MfaVerification;
