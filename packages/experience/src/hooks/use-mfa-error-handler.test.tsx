import { MfaFactor, type RequestErrorBody } from '@logto/schemas';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { UserMfaFlow } from '@/types';

import useMfaErrorHandler from './use-mfa-error-handler';

/**
 * LOGTO PATCH(te-push-as-mfa): la verificación siempre pasa por la lista.
 *
 * Upstream saltaba directo al primer factor —el último usado—, y con un teléfono vinculado eso
 * significa **mandar un SMS sin haberlo pedido**: se paga, llega a alguien que quizá iba a entrar
 * por otro sitio, y no hubo ninguna elección.
 *
 * Y es además lo único que hace elegible «aprobar en el teléfono»: la tarjeta no es un `MfaFactor`
 * —ver `TePushMfaCard`— así que vive en la pantalla de la lista, y a esa pantalla no se llegaba
 * nunca con un solo factor vinculado.
 *
 * Esto se prueba porque es un cambio de comportamiento sobre upstream: un rebase que se lleve el
 * parche por delante no rompe ningún tipo ni ninguna otra prueba, y el síntoma sería un SMS
 * cobrado y el push desaparecido de la pantalla.
 */

const mockedNavigate = jest.fn();
const mockedSendCode = jest.fn();

jest.mock('./use-navigate-with-preserved-search-params', () => ({
  __esModule: true,
  default: () => mockedNavigate,
}));

jest.mock('./use-send-mfa-verification-code', () => ({
  __esModule: true,
  default: () => ({ onSubmit: mockedSendCode }),
}));

jest.mock('./use-toast', () => ({
  __esModule: true,
  default: () => ({ toast: '', setToast: jest.fn() }),
}));

const renderHandler = () =>
  renderHook(() => useMfaErrorHandler(), {
    wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter>,
  });

const errorConFactores = (factors: MfaFactor[]): RequestErrorBody => ({
  code: 'session.mfa.require_mfa_verification',
  message: 'Mfa verification is required to sign in.',
  data: {
    availableFactors: factors,
    maskedIdentifiers: { [MfaFactor.PhoneVerificationCode]: '****3152' },
  },
});

const errorSinFactorVinculado = (): RequestErrorBody => ({
  code: 'user.missing_mfa',
  message: 'missing',
  data: { availableFactors: [MfaFactor.BackupCode] },
});

describe('la verificación de segundo factor nunca decide por la persona', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('con un solo factor vinculado lleva a la lista, no lo dispara', async () => {
    // El caso exacto que se paga: teléfono vinculado y nada más. Upstream mandaba
    // el SMS aquí mismo.
    const { result } = renderHandler();
    const handler = result.current['session.mfa.require_mfa_verification'];

    await act(async () => {
      await handler?.(errorConFactores([MfaFactor.PhoneVerificationCode]));
    });

    expect(mockedSendCode).not.toHaveBeenCalled();
    expect(mockedNavigate).toHaveBeenCalledWith(
      { pathname: `/${UserMfaFlow.MfaVerification}` },
      expect.objectContaining({})
    );
  });

  it('con varios factores, también a la lista', async () => {
    const { result } = renderHandler();
    const handler = result.current['session.mfa.require_mfa_verification'];

    await act(async () => {
      await handler?.(errorConFactores([MfaFactor.PhoneVerificationCode, MfaFactor.BackupCode]));
    });

    expect(mockedSendCode).not.toHaveBeenCalled();
    expect(mockedNavigate).toHaveBeenCalledWith(
      { pathname: `/${UserMfaFlow.MfaVerification}` },
      expect.objectContaining({})
    );
  });

  it('la vinculación con un solo factor sigue saltando a su página', async () => {
    // La otra mitad: vincular no manda nada, y con un solo factor la lista sería
    // una pantalla de un botón. Ahí el salto directo se queda.
    const { result } = renderHandler();
    const handler = result.current['user.missing_mfa'];

    await act(async () => {
      await handler?.(errorSinFactorVinculado());
    });

    expect(mockedNavigate).toHaveBeenCalledWith(
      { pathname: `/${UserMfaFlow.MfaBinding}/${MfaFactor.BackupCode}` },
      expect.objectContaining({})
    );
  });
});
