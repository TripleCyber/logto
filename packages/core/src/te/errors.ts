import { type LogtoErrorCode } from '@logto/phrases';
import { trySafe } from '@silverhand/essentials';
import { type MiddlewareType } from 'koa';

import RequestError from '#src/errors/RequestError/index.js';
import { getConsoleLogFromContext } from '#src/utils/console.js';

import { configTe } from './config.js';

/**
 * Errores del canal hacia el navegador: uniformes en forma y nivelados en latencia.
 *
 * ## Un solo código para casi todo
 *
 * Canal apagado, sesión inexistente, verifier malo, interacción caducada, te-api caído, HMAC
 * rechazado, presupuesto agotado y esquema inválido salen todos como el mismo `400`. También el
 * `429`: el ritmo se comunica por `retryAfterMs` en el sondeo, que es información que el cliente
 * legítimo necesita y el atacante ya tiene de todas formas.
 *
 * Se reutiliza `session.verification_failed`, que ya existe y ya está traducido en las 18
 * localizaciones, en vez de añadir un código nuevo a `@logto/phrases`. La frase («The verification
 * was not successful. Restart the verification flow and try again.») es exactamente la genérica que
 * el contrato pedía, y no tocar `phrases` es lo que mantiene el fork rebasable.
 *
 * ## Y dos excepciones deliberadas
 *
 * {@link codigosDeConfiguracion} pasa verbatim. Son hechos de **configuración**, no de usuario:
 *
 * - `user.identity_not_exist` (403) — la interacción es de alta y este canal es sólo de acceso.
 *   Quien llama eligió él mismo el modo alta; no se le está contando nada que no supiera.
 * - `entity.not_found` (404) — el conector no está en `socialSignInConnectorTargets`. Es el mismo
 *   error, byte a byte, que da un `connectorId` inexistente, así que tampoco enumera nada.
 *
 * Uniformar estos dos rompería las regresiones de C4 sin ganar nada: lo que la uniformidad protege
 * es la existencia de cuentas, carteras y dispositivos, y ninguno de los dos habla de eso. El piso
 * de latencia sí se les aplica igual, para que tampoco se distingan por el reloj.
 */
export const codigoErrorCanal: LogtoErrorCode = 'session.verification_failed';

const codigosDeConfiguracion = new Set<string>(['user.identity_not_exist', 'entity.not_found']);

const errorCanal = () => new RequestError({ code: codigoErrorCanal, status: 400 });

/**
 * Error interno con el motivo real. **No cruza al navegador**: lo consume
 * {@link koaTeChannelUniformErrors}, que lo registra y responde el error uniforme.
 */
export class TeChannelError extends Error {
  constructor(
    public readonly motivo: string,
    /** `requestId` que te-api devuelve en el cuerpo de sus errores, para correlacionar logs. */
    public readonly requestId?: string
  ) {
    super(motivo);
    this.name = 'TeChannelError';
  }
}

const dormir = async (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Middleware que unifica los errores del canal y nivela su latencia.
 *
 * Va **por delante de `koaGuard`** en cada ruta a propósito: los fallos del validador de esquema
 * son los que responden en un milisegundo y delatan qué comprobación falló antes que ninguna otra.
 * Si el piso viviera en el handler, esos errores lo esquivarían.
 *
 * El piso sólo se aplica al camino de error. Nivelar también el éxito no aporta nada — el código de
 * estado ya distingue éxito de fallo — y sí añadiría 300 ms a cada sondeo.
 */
export const koaTeChannelUniformErrors = <StateT, ContextT, ResponseT>(): MiddlewareType<
  StateT,
  ContextT,
  ResponseT
> => {
  return async (ctx, next) => {
    const piso = configTe()?.pisoLatenciaErrorMs ?? 300;
    const inicio = Date.now();

    try {
      await next();
    } catch (error: unknown) {
      // El motivo real, sólo al log. Nunca al cuerpo de la respuesta.
      if (error instanceof TeChannelError) {
        trySafe(() => {
          getConsoleLogFromContext(ctx).warn(
            `[te-channel] ${error.motivo}`,
            error.requestId ? `teApiRequestId=${error.requestId}` : ''
          );
        });
      }

      const restante = piso - (Date.now() - inicio);

      if (restante > 0) {
        await dormir(restante);
      }

      if (error instanceof RequestError && codigosDeConfiguracion.has(error.code)) {
        throw error;
      }

      throw errorCanal();
    }
  };
};
