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

/**
 * Qué canal **completó** la ceremonia. Sobrevive al borrado del estado.
 *
 * Se separa en su propia clave a propósito: lo que hay que borrar en cuanto el `code` se redime es
 * el secreto del canal, no el hecho de haber entrado por él. Guardar el estado entero para poder
 * responder «fue push» alargaría la vida útil del secreto sin ninguna necesidad, y borrarlo entero
 * dejaba a `hasVerifiedTeChannel` sin nada que leer — que es exactamente el fallo que esto arregla:
 * el `submit` pedía un segundo factor **después** de haberlo completado con el teléfono.
 *
 * Aquí no hay nada sensible: dos valores posibles, y sólo se escribe cuando la verificación ya
 * está hecha y verificada.
 */
const claveHecho = 'teChannelHecho';

const resultadoConCanalGuard = z.object({
  [claveResultado]: estadoCanalTeGuard,
});

const resultadoConHechoGuard = z.object({
  [claveHecho]: z.enum(['qr', 'push']),
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
 * Por qué canal se completó la ceremonia, mirando primero la marca que sobrevive al borrado.
 *
 * Se consulta en el `submit`, que corre **después** de `confirm` — o sea, después de que el estado
 * del canal se haya borrado. Por eso la marca primero y el estado vivo como respaldo: el segundo
 * cubre a quien pregunte antes de confirmar.
 */
export const leerCanalCompletado = async (
  ctx: Context,
  provider: Provider
): Promise<'qr' | 'push' | undefined> => {
  const { result } = await provider.interactionDetails(ctx.req, ctx.res);
  const marca = resultadoConHechoGuard.safeParse(result ?? {});

  if (marca.success) {
    return marca.data[claveHecho];
  }

  const vivo = resultadoConCanalGuard.safeParse(result ?? {});

  return vivo.success ? vivo.data[claveResultado].canal : undefined;
};

/**
 * Borra el estado del canal y deja **sólo** la marca de por qué canal se entró.
 *
 * Se llama en cuanto el `code` se ha redimido: a partir de ahí el secreto del canal ya no sirve
 * para nada y guardarlo sólo alarga su vida útil para quien logre leer la sesión. Lo que sí tiene
 * que sobrevivir es el canal, porque el `submit` viene después y es donde se decide si esto exime
 * del segundo factor (ver `hasVerifiedTeChannel`). Borrar las dos cosas juntas era la razón de que
 * el acceso pidiera un segundo factor justo después de aprobarlo en el teléfono.
 */
export const borrarEstadoCanal = async (ctx: Context, provider: Provider): Promise<void> => {
  const details = await provider.interactionDetails(ctx.req, ctx.res);
  const { [claveResultado]: _descartado, ...resto } = details.result ?? {};
  const analizado = resultadoConCanalGuard.safeParse(details.result ?? {});

  await provider.interactionResult(ctx.req, ctx.res, {
    ...resto,
    ...(analizado.success ? { [claveHecho]: analizado.data[claveResultado].canal } : {}),
  });
};
