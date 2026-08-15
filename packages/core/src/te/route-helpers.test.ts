import { createHash } from 'node:crypto';

import { InteractionEvent } from '@logto/schemas';

import RequestError from '#src/errors/RequestError/index.js';

import { TeChannelError } from './errors.js';
import { credencialesDe, exigirReto, rechazarAlta } from './route-helpers.js';
import { type EstadoCanalTe } from './storage.js';

const huellaDe = (verifier: string) =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url');

const estadoQr: EstadoCanalTe = {
  canal: 'qr',
  txnId: 'txn-1',
  verificationId: 'v-1',
  connectorId: 'c-1',
  sessionId: 's-1',
  credenciales: { channelSecret: 'secreto', channelHash: huellaDe('el-verifier') },
};

describe('C4 · rechazo del alta', () => {
  it('rechaza `Register` con el mismo error que da la regla de conectores sólo-acceso', () => {
    try {
      rechazarAlta(InteractionEvent.Register);
      throw new Error('debería haber lanzado');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RequestError);
      expect((error as RequestError).code).toBe('user.identity_not_exist');
      expect((error as RequestError).status).toBe(403);
    }
  });

  it('deja pasar el acceso y el olvido de contraseña', () => {
    expect(() => {
      rechazarAlta(InteractionEvent.SignIn);
      rechazarAlta(InteractionEvent.ForgotPassword);
    }).not.toThrow();
  });
});

describe('las dos cerraduras del canal', () => {
  it('acepta el verifier cuyo sha256 coincide con el hash declarado', () => {
    expect(credencialesDe(estadoQr, 'el-verifier')).toEqual({
      channelSecret: 'secreto',
      verifier: 'el-verifier',
    });
  });

  it('rechaza un verifier que no cuadra, sin gastar una petición s2s', () => {
    expect(() => credencialesDe(estadoQr, 'otro-verifier')).toThrow(TeChannelError);
  });

  it('rechaza si falta el verifier o si el canal no tiene credenciales', () => {
    expect(() => credencialesDe(estadoQr)).toThrow(TeChannelError);
    expect(() => credencialesDe({ ...estadoQr, credenciales: undefined }, 'el-verifier')).toThrow(
      TeChannelError
    );
  });
});

describe('reto push', () => {
  it('no hay estado que consultar mientras no se haya despachado nada', () => {
    expect(() =>
      exigirReto({ canal: 'push', txnId: 't', verificationId: 'v', connectorId: 'c' })
    ).toThrow(TeChannelError);
  });

  it('devuelve el reto vivo', () => {
    expect(
      exigirReto({
        canal: 'push',
        txnId: 't',
        verificationId: 'v',
        connectorId: 'c',
        challengeId: 'reto-1',
      })
    ).toBe('reto-1');
  });
});
