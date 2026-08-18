import { createHash } from 'node:crypto';

import { demoAppApplicationId, InteractionEvent } from '@logto/schemas';
import type { Provider } from 'oidc-provider';

import RequestError from '#src/errors/RequestError/index.js';
import type Queries from '#src/tenants/Queries.js';

import { TeChannelError } from './errors.js';
import { credencialesDe, exigirReto, rechazarAlta, resolverAplicacionRp } from './route-helpers.js';
import { type EstadoCanalTe } from './storage.js';

const huellaDe = (verifier: string) =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url');

/** El catálogo de aplicaciones, recortado a las dos consultas que hace el resolutor. */
const catalogoCon = (
  findApplicationById: () => Promise<unknown>,
  experiencia: unknown = null
): Queries => {
  const doble: unknown = {
    applications: { findApplicationById },
    applicationSignInExperiences: {
      safeFindSignInExperienceByApplicationId: async () => experiencia,
    },
  };

  return doble as Queries;
};

const proveedorCon = (find: () => Promise<unknown>): Provider => {
  const doble: unknown = { Client: { find } };

  return doble as Provider;
};

/** Ni el catálogo ni el proveedor deberían llegar a consultarse. */
const explota = async (): Promise<never> => {
  throw new Error('no debería haberse consultado');
};

/** El proveedor que resuelve sin cliente: no es un error, es que no lo conoce. */
const sinCliente = async (): Promise<void> => {
  // Resuelve sin valor, que es lo que hace `Client.find` con un identificador que no conoce.
};

const careStore = {
  id: 'aplicacion-de-care-store',
  name: 'Care Store',
  oidcClientMetadata: { redirectUris: ['https://care.example/callback'] },
};

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

/**
 * La aplicación que originó el login.
 *
 * La regla que gobierna el bloque entero: **nada de esto puede tumbar un acceso**. Es el nombre que
 * la cartera pinta en una pantalla de aprobación, no un control; una consulta de branding capaz de
 * dejar a alguien fuera de su cuenta sería un intercambio pésimo. Por eso cada caso de fallo tiene
 * su prueba y ninguna espera una excepción.
 */
describe('la aplicación que originó el login', () => {
  it.each([undefined, '', 42, null, { id: 'x' }])(
    'sin un identificador utilizable (%p) no manda nada y no consulta nada',
    async (clientId) => {
      await expect(
        resolverAplicacionRp(clientId, catalogoCon(explota), proveedorCon(explota))
      ).resolves.toBeUndefined();
    }
  );

  it('resuelve nombre, origen y logo desde el catálogo', async () => {
    const rp = await resolverAplicacionRp(
      careStore.id,
      catalogoCon(async () => careStore, {
        displayName: 'Care Store · Farmacia',
        branding: { logoUrl: 'https://care.example/logo.png' },
      }),
      proveedorCon(explota)
    );

    expect(rp).toEqual({
      // `displayName` gana: es lo que la consola deja poner para que lo vea quien accede.
      name: 'Care Store · Farmacia',
      id: careStore.id,
      origin: 'https://care.example',
      logoUrl: 'https://care.example/logo.png',
    });
  });

  /**
   * Las aplicaciones integradas **no tienen fila** y `findApplicationById` lanza en vez de devolver
   * nulo. Se construyen desde la semilla, igual que en `libraries/passcode.ts`.
   */
  it('las aplicaciones integradas salen de la semilla, sin tocar la tabla', async () => {
    const rp = await resolverAplicacionRp(
      demoAppApplicationId,
      catalogoCon(explota),
      proveedorCon(explota)
    );

    // Sin `redirect_uris` registrados no hay origen que enseñar, y no se inventa ninguno.
    expect(rp).toEqual({ id: demoAppApplicationId, name: 'Live Preview' });
  });

  it('si el catálogo no la tiene, repesca lo que ya resolvió oidc-provider', async () => {
    const rp = await resolverAplicacionRp(
      careStore.id,
      catalogoCon(async () => {
        throw new RequestError({ code: 'entity.not_found', status: 404 });
      }),
      proveedorCon(async () => ({
        clientName: 'Care Store',
        // El esquema propio de la aplicación nativa no dice nada en una pantalla: se salta.
        redirectUris: ['careapp://cb', 'https://care.example/callback'],
        logoUri: 'https://care.example/logo.png',
      }))
    );

    expect(rp).toEqual({
      id: careStore.id,
      name: 'Care Store',
      origin: 'https://care.example',
      logoUrl: 'https://care.example/logo.png',
    });
  });

  it('con los dos caminos rotos devuelve el identificador desnudo, nunca una excepción', async () => {
    const rp = await resolverAplicacionRp(
      careStore.id,
      catalogoCon(async () => {
        throw new Error('la base no contesta');
      }),
      proveedorCon(async () => {
        throw new Error('el proveedor tampoco');
      })
    );

    expect(rp).toEqual({ id: careStore.id });
  });

  it('un cliente que el proveedor no conoce tampoco es un fallo', async () => {
    const rp = await resolverAplicacionRp(
      careStore.id,
      catalogoCon(async () => {
        throw new Error('no está');
      }),
      proveedorCon(sinCliente)
    );

    expect(rp).toEqual({ id: careStore.id });
  });

  /**
   * Lo que un cliente no registrado dice llamarse **no llega a la pantalla de aprobación**. Los
   * identificadores de la consola nunca tienen forma de URL; uno que la tiene es un cliente CIMD y
   * su `client_name` sale de un documento que él mismo sirve. Dejarlo pasar sería permitir que
   * quien pide entrar eligiera cómo se llama justo donde se le pide a la persona que lo reconozca.
   */
  it('de un cliente no registrado no se toma el nombre que él mismo se pone', async () => {
    const rp = await resolverAplicacionRp(
      'https://suplantador.example/cliente',
      catalogoCon(async () => {
        throw new Error('no está en el catálogo, obviamente');
      }),
      proveedorCon(async () => ({
        clientName: 'Tu Banco de Toda la Vida',
        redirectUris: ['https://suplantador.example/cb'],
        logoUri: 'https://suplantador.example/logo-del-banco.png',
      }))
    );

    // Sin nombre, te-api cae a su cliente OAuth: mejor un nombre anodino que uno elegido por
    // quien ataca. El identificador se queda porque una URL sí es infalsificable.
    expect(rp).toEqual({
      id: 'https://suplantador.example/cliente',
      origin: 'https://suplantador.example',
    });
  });

  it('un identificador que no cabe en el contrato de te-api no se manda', async () => {
    // Mandarlo tumbaría la petición entera con un 400 y el login se caería por una etiqueta.
    const rp = await resolverAplicacionRp(
      `https://larguisimo.example/${'x'.repeat(200)}`,
      catalogoCon(explota),
      proveedorCon(explota)
    );

    expect(rp).toBeUndefined();
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
