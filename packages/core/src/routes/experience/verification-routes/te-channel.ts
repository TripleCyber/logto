import { VerificationType } from '@logto/schemas';
import { Action } from '@logto/schemas/lib/types/log/interaction.js';
import { generateStandardId } from '@logto/shared';
import type Router from 'koa-router';
import { z } from 'zod';

import koaGuard from '#src/middleware/koa-guard.js';
import { clienteTe } from '#src/te/client.js';
import { configTe } from '#src/te/config.js';
import { koaTeChannelUniformErrors, TeChannelError } from '#src/te/errors.js';
import {
  credencialesDe,
  cuerpoCrearCanalGuard,
  exigirConfig,
  exigirReto,
  rechazarAlta,
  resolverConectorTe,
} from '#src/te/route-helpers.js';
import {
  borrarEstadoCanal,
  escribirEstadoCanal,
  leerEstadoCanal,
  type EstadoCanalTe,
} from '#src/te/storage.js';
import {
  enmascararDespacho,
  enmascararDispositivo,
  estadosTerminales,
  respuestaCanalGuard,
  respuestaConfigGuard,
  respuestaDispositivosGuard,
  respuestaSondeoGuard,
  retoPushGuard,
  ritmoSondeoMs,
  topeDispositivos,
  type DespachoTeApi,
  type MarcoCanal,
} from '#src/te/types.js';
import type TenantContext from '#src/tenants/TenantContext.js';

import { SocialVerification } from '../classes/verifications/social-verification.js';
import { experienceRoutes } from '../const.js';
import koaExperienceVerificationsAuditLog from '../middleware/koa-experience-verifications-audit-log.js';
import { type ExperienceInteractionRouterContext } from '../types.js';

/**
 * LOGTO PATCH(te-channel-proxy): rutas del canal TripleEnable, servidas por Logto en su propio
 * origen y proxeadas servidor a servidor hacia te-api.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE FICHERO
 *
 * La UI del QR y del push vive dentro de la experiencia de Logto. Si el navegador
 * llamase a te-api directamente, esas llamadas serían cross-origin y las cookies
 * del canal pasarían a ser de terceros — Safari las bloquea de fábrica. Parchear
 * eso con `SameSite=None` sería cambiar una defensa por un agujero. Con el proxy
 * se obtienen las dos cosas de una vez: el QR dentro de Logto, y te-api
 * inalcanzable desde cualquier navegador.
 *
 * CORS NO SIRVE PARA ESTO. Lo impone el navegador; un cliente que no lo sea
 * ignora `Origin` en una línea. CORS evita que otra web llame desde el navegador
 * de la víctima, no que alguien llame con curl. La defensa es la autenticación
 * servidor-a-servidor con HMAC (`#src/te/hmac.ts`) más te-api en red privada.
 * Que nadie construya ninguna decisión de permisos encima de una cabecera
 * `Origin`, ni añada el origen de te-api a `connect-src` de la CSP.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Las rutas se montan en el `experienceRouter`, con lo que heredan
 * `koaInteractionDetails`, `koaExperienceInteraction`, `koaExperienceAuditLog` y `koaGuard`. Y
 * **no** se añaden a `whiteListedEndpoint`: exigir una interacción OIDC viva es la precondición que
 * impide que una sesión de canal exista fuera de un login en curso (DS-2).
 *
 * Upstream: (no existe)
 */

const prefijo = `${experienceRoutes.verification}/te-channel`;

/** Cabecera del verifier del canal. **Jamás en el query ni en el path** (ST-1). */
const cabeceraVerifier = 'x-channel-verifier';

export default function teChannelRoutes<T extends ExperienceInteractionRouterContext>(
  router: Router<unknown, T>,
  tenantContext: TenantContext
) {
  const { libraries, queries, connectors, provider, envSet } = tenantContext;

  /**
   * El nivelador de errores se registra como capa de prefijo, no como middleware de cada ruta, y
   * eso es deliberado: así envuelve también a `koaGuard`. Los fallos del validador de esquema son
   * los que responden en un milisegundo y delatan qué comprobación falló antes que ninguna otra;
   * si el piso de latencia viviera dentro del handler, esos errores lo esquivarían.
   */
  router.use(prefijo, koaTeChannelUniformErrors());

  const cargarEstado = async (ctx: Parameters<typeof leerEstadoCanal>[0]) => {
    const estado = await leerEstadoCanal(ctx, provider);

    if (!estado) {
      throw new TeChannelError('no hay canal abierto en esta interacción');
    }

    return estado;
  };

  /**
   * Interruptores del canal. **El apagado se nota aquí, en la UI, no en un 4xx al usarlo.**
   *
   * Si te-api no contesta, el cliente devuelve todo apagado (fail-closed) y la experiencia
   * sencillamente no ofrece el factor. Un botón que existe y falla es peor que un botón que no
   * está: el primero convierte una caída en un fallo de acceso atribuido al usuario.
   */
  router.get(
    `${prefijo}/config`,
    koaGuard({ response: respuestaConfigGuard, status: [200, 400] }),
    async (ctx, next) => {
      const config = configTe();

      if (!config) {
        ctx.body = { channels: { qr: false, push: false }, devicePicker: 'lazy' as const };
        return next();
      }

      // Un conector apagado en consola apaga el factor sin desplegar nada.
      const habilitado = await resolverConectorTe(connectors, queries).then(
        () => true,
        () => false
      );

      const canales = habilitado
        ? await clienteTe(config).interruptores()
        : { qr: false, push: false };

      ctx.body = { channels: canales, devicePicker: config.politicaSelectorDispositivos };

      return next();
    }
  );

  /**
   * Abre el canal: crea el `SocialVerification`, abre la transacción en te-api y, si el canal es
   * QR, devuelve el primer código ya rotado.
   *
   * El `state`, el `code_verifier` de PKCE y el `redirect_uri` los pone el conector, no esta ruta:
   * se construye la URL de autorización con el mecanismo de siempre y se le pasan a te-api sus
   * parámetros. Así el canje del `code` en `confirm` funciona sin ninguna ruta especial, y
   * `redirect_uri` se sigue comparando byte a byte en te-api (CN-4) aunque nadie navegue a él.
   */
  router.post(
    prefijo,
    koaGuard({
      body: cuerpoCrearCanalGuard,
      response: respuestaCanalGuard.partial({ sessionId: true, expiresAt: true, code: true }),
      status: [200, 400, 403, 404],
    }),
    koaExperienceVerificationsAuditLog({ type: VerificationType.Social, action: Action.Create }),
    async (ctx, next) => {
      const config = exigirConfig();
      const cuerpo = ctx.guard.body;

      rechazarAlta(ctx.experienceInteraction.interactionEvent);

      const conector = await resolverConectorTe(connectors, queries);
      const connectorId = conector.dbEntry.id;

      const cliente = clienteTe(config);
      const canales = await cliente.interruptores();

      if (!canales[cuerpo.channel]) {
        throw new TeChannelError(`canal ${cuerpo.channel} apagado en te-api`);
      }

      const verificacion = SocialVerification.create(libraries, queries, connectorId);
      const redirectUri = new URL(`/callback/${connectorId}`, envSet.endpoint).href;

      const urlAutorizacion = await verificacion.createAuthorizationUrl(ctx, tenantContext, {
        state: generateStandardId(),
        redirectUri,
      });

      // NW-1: la IP del navegador la mide Logto y viaja firmada dentro del HMAC. Sin esto te-api
      // guardaría la IP del centro de datos y la cartera enseñaría un contexto falso.
      const { txnId } = await cliente.crearTransaccion(
        urlAutorizacion,
        { ip: ctx.request.ip, userAgent: ctx.request.headers['user-agent'] },
        cuerpo.channel === 'push' ? cuerpo.loginHint : undefined
      );

      const comun = {
        canal: cuerpo.channel,
        txnId,
        verificationId: verificacion.id,
        connectorId,
      };

      // El identificador no entra en el log de auditoría: el canal push ya lo convierte en huella
      // en te-api, y registrarlo aquí lo devolvería al claro.
      ctx.verificationAuditLog.append({ payload: { connectorId, channel: cuerpo.channel } });

      const sesion =
        cuerpo.channel === 'qr'
          ? await cliente.crearSesionQr(txnId, cuerpo.channelHash)
          : undefined;

      const estado: EstadoCanalTe =
        sesion && cuerpo.channel === 'qr'
          ? {
              ...comun,
              sessionId: sesion.sessionId,
              credenciales: {
                channelSecret: sesion.channelSecret,
                channelHash: cuerpo.channelHash,
              },
            }
          : comun;

      // Ni el `txnId` ni el secreto del canal cruzan al navegador: viven sólo en el almacén de la
      // interacción, del lado del servidor.
      ctx.body = sesion
        ? {
            verificationId: verificacion.id,
            sessionId: sesion.sessionId,
            expiresAt: sesion.expiresAt,
            code: sesion.code,
          }
        : { verificationId: verificacion.id };

      ctx.experienceInteraction.setVerificationRecord(verificacion);
      await ctx.experienceInteraction.save();
      await escribirEstadoCanal(ctx, provider, estado);

      return next();
    }
  );

  /** Rotación del código del QR. */
  router.post(
    `${prefijo}/code`,
    koaGuard({ response: respuestaCanalGuard.shape.code, status: [200, 400] }),
    async (ctx, next) => {
      const config = exigirConfig();
      const estado = await cargarEstado(ctx);

      if (estado.canal !== 'qr' || !estado.sessionId) {
        throw new TeChannelError('rotación pedida sobre un canal que no es QR');
      }

      ctx.body = await clienteTe(config).rotarCodigo(
        estado.sessionId,
        credencialesDe(estado, ctx.request.headers[cabeceraVerifier]?.toString())
      );

      return next();
    }
  );

  /**
   * Sondeo. Devuelve el marco derivado de la fila (CH-6) y el ritmo con el que hay que volver.
   *
   * El ritmo lo dicta el servidor, no el cliente: 1500 ms mientras se pinta el código, 700 ms una
   * vez reclamado, y 0 en cualquier estado terminal, que es la señal de parar. `approved`
   * **notifica**; quien decide es `confirm`.
   */
  router.post(
    `${prefijo}/poll`,
    koaGuard({ response: respuestaSondeoGuard, status: [200, 400] }),
    async (ctx, next) => {
      const config = exigirConfig();
      const estado = await cargarEstado(ctx);
      const cliente = clienteTe(config);

      const sondeo: { frame: MarcoCanal; despacho?: DespachoTeApi } =
        estado.canal === 'qr' && estado.sessionId
          ? {
              frame: await cliente.estadoSesionQr(
                estado.sessionId,
                credencialesDe(estado, ctx.request.headers[cabeceraVerifier]?.toString())
              ),
            }
          : await cliente.estadoPush(exigirReto(estado), estado.txnId);

      const marco = sondeo.frame;

      // PU-12: la lista de dispositivos sólo se abre después de que un reto real haya fallado. Ese
      // fallo cuesta una notificación en la pantalla de bloqueo del titular, que es lo que convierte
      // enumerar en un evento de detección en vez de en reconocimiento gratis.
      if (
        estado.canal === 'push' &&
        !estado.selectorDesbloqueado &&
        estadosTerminales.has(marco.t) &&
        marco.t !== 'approved'
      ) {
        await escribirEstadoCanal(ctx, provider, { ...estado, selectorDesbloqueado: true });
      }

      /*
       * La etiqueta de destino: **a dónde fue el aviso**, que es lo que la pantalla de espera del
       * push no sabía decir. Sale por la misma proyección con lista blanca que la lista de
       * dispositivos (`enmascararDespacho`), así que lo que llega al navegador son como mucho tres
       * claves: cuántos destinos, y —sólo si fue uno— categoría gruesa y cubeta temporal. El
       * nombre que la persona le puso a su teléfono no cabe en el tipo de salida.
       *
       * Y llega para un reto real y para uno señuelo por igual: te-api fabrica la del señuelo con
       * un HMAC del identificador precisamente para que esta línea no pueda delatar si la cuenta
       * existe (PU-4). Aquí no hay ninguna rama que lo distinga, y no puede haberla.
       */
      ctx.body = {
        frame: marco,
        retryAfterMs: ritmoSondeoMs(marco),
        ...(sondeo.despacho ? { dispatch: enmascararDespacho(sondeo.despacho) } : {}),
      };

      return next();
    }
  );

  /**
   * Confirma y redime.
   *
   * **Aquí muere el `code` OAuth2.** te-api devuelve la URL de retorno con `code` y `state`; se
   * parsean en este servidor, se le pasan al `SocialVerification` para que el conector haga el
   * canje s2s con su `code_verifier` y su `state`, y al navegador le vuelve `{ verificationId }` y
   * nada más. El `code` no va al cuerpo, no va al log y no se serializa hacia fuera.
   *
   * A partir de ahí el navegador sigue el camino nativo — `POST /api/experience/identification` y
   * `POST /api/experience/submit` — con lo que MFA, perfil obligatorio y alta de passkey siguen
   * aplicando exactamente igual que en cualquier otro factor.
   */
  router.post(
    `${prefijo}/confirm`,
    koaGuard({ response: z.object({ verificationId: z.string() }), status: [200, 400, 403, 404] }),
    koaExperienceVerificationsAuditLog({ type: VerificationType.Social, action: Action.Submit }),
    async (ctx, next) => {
      const config = exigirConfig();

      rechazarAlta(ctx.experienceInteraction.interactionEvent);

      const estado = await cargarEstado(ctx);
      const cliente = clienteTe(config);

      const { redirectTo } =
        estado.canal === 'qr' && estado.sessionId
          ? await cliente.confirmarSesionQr(
              estado.sessionId,
              credencialesDe(estado, ctx.request.headers[cabeceraVerifier]?.toString())
            )
          : await cliente.confirmarRetoPush(exigirReto(estado), estado.txnId);

      const { searchParams } = new URL(redirectTo);
      const code = searchParams.get('code');
      const state = searchParams.get('state');

      if (!code || !state) {
        throw new TeChannelError('te-api confirmó sin code o sin state');
      }

      const verificacion = ctx.experienceInteraction.getVerificationRecordByTypeAndId(
        VerificationType.Social,
        estado.verificationId
      );

      await verificacion.verify(ctx, tenantContext, { code, state });

      // El captcha ya no aplica: la identidad la acredita el conector, igual que en el callback
      // social normal.
      ctx.experienceInteraction.skipCaptcha();
      await ctx.experienceInteraction.save();
      await borrarEstadoCanal(ctx, provider);

      // Nunca `redirectTo`, nunca `code`, nunca `state`.
      ctx.verificationAuditLog.append({ payload: { connectorId: estado.connectorId } });
      ctx.body = { verificationId: verificacion.id };

      return next();
    }
  );

  /**
   * C3, paso 1 y 3: despacha el push.
   *
   * Sin `deviceRef` te-api elige el dispositivo elegible más reciente y **no se enseña nada**: cero
   * información antes de que nadie demuestre nada. La respuesta es idéntica cuando el identificador
   * no resuelve a ningún usuario (te-api crea una fila señuelo y no despacha), así que esperar y
   * fallar es indistinguible de esperar y que la persona no apruebe.
   */
  router.post(
    `${prefijo}/push`,
    koaGuard({
      body: z.object({ deviceRef: z.string().max(256).optional() }),
      response: retoPushGuard,
      status: [200, 400, 403, 404],
    }),
    async (ctx, next) => {
      const config = exigirConfig();

      rechazarAlta(ctx.experienceInteraction.interactionEvent);

      const estado = await cargarEstado(ctx);

      if (estado.canal !== 'push') {
        throw new TeChannelError('despacho push sobre un canal que no es push');
      }

      const cliente = clienteTe(config);

      const canales = await cliente.interruptores();

      if (!canales.push) {
        throw new TeChannelError('canal push apagado en te-api');
      }

      const reto = await cliente.despacharPush(estado.txnId, ctx.guard.body.deviceRef);

      await escribirEstadoCanal(ctx, provider, { ...estado, challengeId: reto.challengeId });

      ctx.body = reto;

      return next();
    }
  );

  /**
   * C3, paso 2: la lista enmascarada.
   *
   * Sólo se abre tras un reto fallido o caducado, salvo que el tenant haya puesto
   * `TE_PUSH_DEVICE_PICKER=eager` — cuyo coste está escrito al lado de la bandera, en
   * `#src/te/config.ts`. Antes de eso responde el error uniforme del canal, indistinguible de
   * cualquier otro fallo.
   *
   * Lo que sale de aquí lleva tres claves y sólo tres: `deviceRef` opaco, categoría gruesa y
   * antigüedad en cubetas. La proyección construye objetos nuevos (`enmascararDispositivo`) en vez
   * de reenviar lo que llegó, para que un campo nuevo en te-api no se filtre solo hasta la pantalla
   * de acceso. Nada de nombres puestos por el usuario, modelos, versiones de sistema ni marcas de
   * tiempo: eso se puede enseñar **después** de aprobar.
   */
  router.post(
    `${prefijo}/push/devices`,
    koaGuard({ response: respuestaDispositivosGuard, status: [200, 400, 403, 404] }),
    async (ctx, next) => {
      const config = exigirConfig();

      rechazarAlta(ctx.experienceInteraction.interactionEvent);

      const estado = await cargarEstado(ctx);

      if (estado.canal !== 'push') {
        throw new TeChannelError('lista de dispositivos sobre un canal que no es push');
      }

      if (config.politicaSelectorDispositivos === 'lazy' && !estado.selectorDesbloqueado) {
        throw new TeChannelError('selector de dispositivos aún bloqueado (PU-12)');
      }

      const { devices } = await clienteTe(config).listarDispositivos(
        estado.txnId,
        exigirReto(estado),
        // `eager` tiene que viajar hasta te-api: allí el selector también nace cerrado, y sin este
        // dato la bandera abriría sólo esta puerta para chocar con la siguiente.
        config.politicaSelectorDispositivos === 'eager'
      );

      ctx.body = {
        devices: devices.slice(0, topeDispositivos).map((bruto) => enmascararDispositivo(bruto)),
      };

      return next();
    }
  );
}
