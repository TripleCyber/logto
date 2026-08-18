import { createHash } from 'node:crypto';

import { ConnectorType } from '@logto/connector-kit';
import {
  buildBuiltInApplicationDataForTenant,
  InteractionEvent,
  isBuiltInApplicationId,
  type Application,
} from '@logto/schemas';
import { conditional, trySafe } from '@silverhand/essentials';
import type { Provider } from 'oidc-provider';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import type { ConnectorLibrary } from '#src/libraries/connector.js';
import { assertSocialSignInConnectorEnabled } from '#src/libraries/verification-helpers/social-verification.js';
import type Queries from '#src/tenants/Queries.js';
import { buildApplicationContextInfo } from '#src/utils/connectors/extra-information.js';

import { configTe, objetivoConectorTe } from './config.js';
import { TeChannelError } from './errors.js';
import { igualesEnTiempoConstante } from './hmac.js';
import { type EstadoCanalTe } from './storage.js';
import { type AplicacionRp } from './types.js';

/**
 * Comprobaciones compartidas por las rutas del canal (`routes/experience/verification-routes/
 * te-channel.ts`). Están fuera del fichero de rutas para que cada una tenga su porqué escrito una
 * sola vez y para que la ruta sea legible de un vistazo.
 */

export const cuerpoCrearCanalGuard = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('qr'),
    /** `base64url(sha256(verifier))`, calculado en el navegador. Ligadura tipo PKCE. */
    channelHash: z.string().min(1).max(128),
  }),
  z.object({
    channel: z.literal('push'),
    /**
     * Identificador que la persona tecleó. Viaja en el cuerpo, nunca en el query. te-api sólo
     * guarda su huella (`login_hint_fp`); el valor en claro no se almacena en ninguna de sus
     * tablas, y aquí tampoco se registra en el log de auditoría.
     */
    loginHint: z.string().min(1).max(320),
  }),
]);

/**
 * Sin configuración el canal está apagado. El navegador no debería haber llegado hasta aquí porque
 * `GET .../config` ya le dijo que no, pero la ruta no se fía de eso.
 */
export const exigirConfig = () => {
  const config = configTe();

  if (!config) {
    throw new TeChannelError('canal sin configurar');
  }

  return config;
};

/**
 * Resuelve el conector de TripleEnable por `target` y aplica el interruptor de consola.
 *
 * Se resuelve por `target` y no por id porque `target` es lo que la consola guarda en
 * `sign_in_experiences.social_sign_in_connector_targets` y lo que usa `signInOnlyConnectorTargets`.
 * Un id codificado aquí dejaría de coincidir en cuanto alguien recreara el conector.
 *
 * `assertSocialSignInConnectorEnabled` lanza el mismo `404 entity.not_found` que un id inexistente,
 * así que un conector apagado no se distingue de uno que no existe. Las rutas del canal no pasan por
 * `createSocialAuthorizationUrl`, que es donde upstream aplica ese interruptor, así que hay que
 * invocarlo aquí explícitamente: si no, apagar el conector en consola escondería el botón y dejaría
 * la ruta contestando a quien la llamara a mano.
 */
export const resolverConectorTe = async (connectors: ConnectorLibrary, queries: Queries) => {
  const todos = await connectors.getLogtoConnectors();
  const conector = todos.find(
    ({ type, metadata }) => type === ConnectorType.Social && metadata.target === objetivoConectorTe
  );

  if (!conector) {
    throw new RequestError({ code: 'entity.not_found', status: 404 });
  }

  await assertSocialSignInConnectorEnabled(queries, conector);

  return conector;
};

/**
 * El origen que se **enseña**, derivado de los `redirect_uris` registrados.
 *
 * Se toma el primero que sea `http(s)` y se recorta a su origen: lo que la persona tiene que poder
 * contrastar es la marca, no una ruta de callback. Los esquemas propios de las aplicaciones
 * nativas (`careapp://…`) se saltan porque no dicen nada en una pantalla de aprobación.
 */
const origenDe = (redirectUris?: readonly string[]): string | undefined =>
  redirectUris
    ?.map((uri) => trySafe(() => new URL(uri)))
    .find((url) => url?.protocol === 'http:' || url?.protocol === 'https:')?.origin;

/**
 * Topes del esquema de te-api (`cuerpoTransaccion.rp` en `src/routes/s2s.ts`).
 *
 * Lo que no quepa **se descarta aquí**, no se manda recortado ni se manda entero: un valor fuera de
 * contrato haría que te-api rechazara el cuerpo con un 400 y el login se caería por una etiqueta
 * de adorno. Aquí la regla es siempre la misma: perder el nombre, nunca el acceso.
 */
const topes = { nombre: 256, origen: 512, logo: 2048, id: 128 } as const;

const cabe = (valor: string | undefined, tope: number): string | undefined =>
  valor !== undefined && valor !== '' && valor.length <= tope ? valor : undefined;

/** La forma que viaja a te-api, sin claves con `undefined` dentro del cuerpo firmado. */
const componer = (
  id: string,
  datos: { nombre?: string; origen?: string; logo?: string }
): AplicacionRp => ({
  id,
  ...conditional(cabe(datos.nombre, topes.nombre) && { name: datos.nombre }),
  ...conditional(cabe(datos.origen, topes.origen) && { origin: datos.origen }),
  ...conditional(cabe(datos.logo, topes.logo) && { logoUrl: datos.logo }),
});

/**
 * ¿Es un cliente que la consola **no** registró?
 *
 * Los identificadores que reparte la consola nunca tienen forma de URL, así que uno que la tiene es
 * un cliente CIMD: sus metadatos —`client_name` y `logo_uri` incluidos— los sirve un documento que
 * controla el propio cliente. Es la misma lectura que hace `routes/interaction/consent`.
 */
const esClienteNoRegistrado = (clientId: string): boolean =>
  clientId.startsWith('http://') || clientId.startsWith('https://');

/**
 * El camino normal: el catálogo de aplicaciones y su experiencia de acceso.
 *
 * Las aplicaciones **integradas** (la demo, el centro de cuenta, la vista previa del flujo de
 * dispositivo) no tienen fila, y `findApplicationById` lanza en vez de devolver nulo — el mismo
 * escalón que esquiva `libraries/passcode.ts`. Se construyen desde la semilla igual que allí.
 *
 * `displayName` gana a `name` porque es lo que la consola deja poner para que lo vea quien accede;
 * `name` es el rótulo interno del catálogo.
 */
const resolverDesdeCatalogo = async (clientId: string, queries: Queries): Promise<AplicacionRp> => {
  const [aplicacion, experiencia] = await Promise.all([
    isBuiltInApplicationId(clientId)
      ? Promise.resolve<Application>(buildBuiltInApplicationDataForTenant('', clientId))
      : queries.applications.findApplicationById(clientId),
    queries.applicationSignInExperiences.safeFindSignInExperienceByApplicationId(clientId),
  ]);

  const { id, name, branding, displayName } = buildApplicationContextInfo(aplicacion, experiencia);

  return componer(id, {
    nombre: displayName ?? name,
    origen: origenDe(aplicacion.oidcClientMetadata.redirectUris),
    logo: branding?.logoUrl,
  });
};

/**
 * El repesque: los metadatos que ya resolvió oidc-provider.
 *
 * `ctx.oidc.client` **no existe** en el router de la experiencia —estas rutas se sirven desde la
 * Experience API, no desde dentro del flujo de autorización—, así que el equivalente es preguntarle
 * al proveedor por el cliente. Cubre lo que el catálogo no puede: un cliente que oidc-provider
 * conoce y la tabla de aplicaciones no.
 */
const resolverDesdeProveedor = async (
  clientId: string,
  provider: Provider
): Promise<AplicacionRp | undefined> => {
  const cliente = await provider.Client.find(clientId);

  if (!cliente) {
    return undefined;
  }

  /*
   * De un cliente **no registrado** no se toma ni el nombre ni el logo. Los sirve un documento que
   * él mismo controla (CIMD draft-02 §8.5), y esto acaba pintado en la pantalla donde se le pide a
   * la persona que reconozca a quién está autorizando: dejar que quien pide entrar elija cómo se
   * llama ahí es regalar la suplantación. Se queda sólo el identificador —una URL, que sí es
   * infalsificable— y con él te-api cae a su cliente OAuth, que es lo correcto: mejor un nombre
   * anodino que uno elegido por quien ataca.
   */
  if (esClienteNoRegistrado(clientId)) {
    return componer(clientId, { origen: origenDe([clientId]) });
  }

  return componer(clientId, {
    nombre: cliente.clientName,
    origen: origenDe(cliente.redirectUris),
    logo: cliente.logoUri,
  });
};

/**
 * La aplicación que originó el login, para que la cartera diga «Care Store» y no «Logto».
 *
 * **Nada de lo que pase aquí puede tumbar un acceso.** Es adorno de una pantalla, no un control:
 * por eso los dos caminos van envueltos y el peor resultado es mandar el identificador desnudo —
 * con el que te-api cae, como siempre, al nombre de su cliente OAuth. Que la resolución falle y el
 * login siga es el comportamiento correcto; lo contrario sería una consulta de branding capaz de
 * dejar a alguien fuera de su cuenta.
 *
 * `clientId` llega como `unknown` porque así lo declara `interactionDetails.params`, y se estrecha
 * aquí en vez de en la ruta para que el único sitio que decide qué es un identificador utilizable
 * sea éste.
 *
 * **No se usa `getFullSignInExperience`**: descarta el branding de las aplicaciones de terceros y
 * toma el identificador de aplicación de un parámetro del query, que es exactamente la propiedad —
 * «esto no lo elige el navegador»— de la que depende que este nombre se pueda pintar.
 */
export const resolverAplicacionRp = async (
  clientId: unknown,
  queries: Queries,
  provider: Provider
): Promise<AplicacionRp | undefined> => {
  // El tope es el del esquema de te-api: un identificador más largo haría que rechazara el cuerpo
  // entero con un 400 y el login se caería por una etiqueta de adorno.
  if (typeof clientId !== 'string' || clientId === '' || clientId.length > topes.id) {
    return undefined;
  }

  const delCatalogo = await trySafe(resolverDesdeCatalogo(clientId, queries));

  if (delCatalogo) {
    return delCatalogo;
  }

  return (await trySafe(resolverDesdeProveedor(clientId, provider))) ?? { id: clientId };
};

/**
 * C4: en el alta no se puede continuar con TripleEnable.
 *
 * Todo usuario existe primero en Logto y después se vincula a la cartera, así que este canal es de
 * acceso y nunca de creación. El botón no se pinta en el alta, y esta comprobación es lo que hace
 * que la ruta lo rechace igual aunque alguien la llame a mano. El `403 user.identity_not_exist` es
 * exactamente el que ya da `assertSocialTargetsAllowRegistration` para el mismo hecho, así que no
 * añade ninguna señal nueva.
 */
export const rechazarAlta = (evento: InteractionEvent) => {
  if (evento === InteractionEvent.Register) {
    throw new RequestError({ code: 'user.identity_not_exist', status: 403 });
  }
};

/**
 * Las dos cerraduras del canal: el secreto que sólo conoce este servidor y el verifier que sólo
 * tiene el navegador que abrió la sesión. Falta cualquiera de las dos y no hay llamada a te-api.
 *
 * El verifier se comprueba también aquí, contra el `channelHash` que el navegador declaró al abrir
 * el canal. **te-api sigue siendo la autoridad** —él guarda `qr_session.channel_hash` y él decide—;
 * esta comprobación es defensa en profundidad y ahorro: un verifier que no cuadra no llega a gastar
 * una petición s2s ni una entrada del cubo de tasa. La comparación va en tiempo constante porque el
 * hash es público pero el verifier no, y comparar con `===` filtra por dónde empieza a diferir.
 */
export const credencialesDe = (estado: EstadoCanalTe, verifier?: string) => {
  if (!estado.credenciales || !verifier) {
    throw new TeChannelError('faltan credenciales del canal');
  }

  const huella = createHash('sha256').update(verifier, 'utf8').digest('base64url');

  if (!igualesEnTiempoConstante(huella, estado.credenciales.channelHash)) {
    throw new TeChannelError('el verifier no corresponde al hash declarado al abrir el canal');
  }

  return { channelSecret: estado.credenciales.channelSecret, verifier };
};

/** Un reto push que aún no se ha despachado no tiene estado que consultar. */
export const exigirReto = (estado: EstadoCanalTe): string => {
  if (!estado.challengeId) {
    throw new TeChannelError('no hay reto push despachado en esta interacción');
  }

  return estado.challengeId;
};
