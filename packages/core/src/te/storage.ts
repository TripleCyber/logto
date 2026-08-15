import { type Context } from 'koa';
import { type Provider } from 'oidc-provider';
import { z } from 'zod';

/**
 * Estado del canal, atado a la interacción OIDC que el navegador ya tiene abierta.
 *
 * ## Por qué la interacción es el ancla, y no un identificador propio
 *
 * Un `channelId` propio sería un espacio de nombres paralelo que se puede pedir sin estar
 * intentando entrar en ningún sitio: una sesión de QR podría existir fuera de un login real, que es
 * DS-2 exactamente. Colgando el estado de la interacción, el canal hereda tres cosas que no hay que
 * volver a construir: la cookie de interacción es `__Host`-prefijada y del mismo origen, caduca con
 * el login, y desaparece al terminarlo. No hay canal sin login en curso porque no hay dónde
 * guardarlo.
 *
 * ## Por qué en `interactionDetails.result` y no en `InteractionStorage`
 *
 * `ExperienceInteraction.save()` escribe `{ ...details.result, ...this.toJson() }`, así que
 * cualquier clave del resultado que `InteractionStorage` no conozca **sobrevive** a los guardados
 * de la interacción. Es el mismo mecanismo con el que upstream lleva `connectorSession`
 * (`assignConnectorSessionResult`), y usarlo evita modificar `types.ts` y
 * `experience-interaction.ts`, que son dos de los ficheros que más duelen al rebasar.
 */

const credencialesCanalGuard = z.object({
  /** Secreto que te-api emitía como cookie `__Host-te_ch`. Nunca sale de este servidor. */
  channelSecret: z.string(),
  /** `sha256(verifier)` que el navegador declaró al abrir el canal. */
  channelHash: z.string(),
});

const estadoCanalTeGuard = z.object({
  canal: z.enum(['qr', 'push']),
  /** Transacción OAuth en te-api. Como el `txnId` de la vieja cookie `__Host-te_txn`. */
  txnId: z.string(),
  /** Id del `SocialVerification` que redimirá el `code`. Ata el canal a la verificación. */
  verificationId: z.string(),
  connectorId: z.string(),
  sessionId: z.string().optional(),
  credenciales: credencialesCanalGuard.optional(),
  challengeId: z.string().optional(),
  /**
   * Se pone a `true` cuando un reto push acaba en fallo, rechazo o caducidad. Es la llave del
   * selector de dispositivos (PU-12): antes de eso, pedir la lista responde el error uniforme.
   */
  selectorDesbloqueado: z.boolean().optional(),
});

export type EstadoCanalTe = z.infer<typeof estadoCanalTeGuard>;

const claveResultado = 'teChannel';

const resultadoConCanalGuard = z.object({
  [claveResultado]: estadoCanalTeGuard,
});

export const leerEstadoCanal = async (
  ctx: Context,
  provider: Provider
): Promise<EstadoCanalTe | undefined> => {
  const { result } = await provider.interactionDetails(ctx.req, ctx.res);
  const analizado = resultadoConCanalGuard.safeParse(result ?? {});

  return analizado.success ? analizado.data[claveResultado] : undefined;
};

export const escribirEstadoCanal = async (
  ctx: Context,
  provider: Provider,
  estado: EstadoCanalTe
): Promise<void> => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);

  await provider.interactionResult(ctx.req, ctx.res, {
    ...details.result,
    [claveResultado]: estado,
  });
};

/**
 * Borra el estado del canal. Se llama en cuanto el `code` se ha redimido: a partir de ahí el
 * secreto del canal ya no sirve para nada y guardarlo sólo alarga su vida útil para quien logre
 * leer la sesión.
 */
export const borrarEstadoCanal = async (ctx: Context, provider: Provider): Promise<void> => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  const { [claveResultado]: _descartado, ...resto } = details.result ?? {};

  await provider.interactionResult(ctx.req, ctx.res, resto);
};
