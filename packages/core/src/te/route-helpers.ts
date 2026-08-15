import { createHash } from 'node:crypto';

import { ConnectorType } from '@logto/connector-kit';
import { InteractionEvent } from '@logto/schemas';
import { z } from 'zod';

import RequestError from '#src/errors/RequestError/index.js';
import type { ConnectorLibrary } from '#src/libraries/connector.js';
import { assertSocialSignInConnectorEnabled } from '#src/libraries/verification-helpers/social-verification.js';
import type Queries from '#src/tenants/Queries.js';

import { configTe, objetivoConectorTe } from './config.js';
import { TeChannelError } from './errors.js';
import { igualesEnTiempoConstante } from './hmac.js';
import { type EstadoCanalTe } from './storage.js';

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
