import { PassThrough } from 'node:stream';

import type Router from 'koa-router';

import { alMorirEventosTe, escucharReto } from '#src/te/eventos.js';
import { rechazarAlta } from '#src/te/route-helpers.js';
import { leerEstadoCanal } from '#src/te/storage.js';

import { type ExperienceInteractionRouterContext } from '../types.js';

/**
 * LOGTO PATCH(te-senalizacion): el aviso en tiempo real, **al lado del sondeo**.
 *
 * ## Por qué esto no sustituye al sondeo
 *
 * Porque así no puede empeorar nada. El navegador abre este flujo **y sigue
 * sondeando**: si el timbre funciona, entra en decenas de milisegundos; si no
 * —Redis caído, mensaje perdido, un proxy que corta— el sondeo lo cubre y nadie
 * se entera. Sustituirlo de golpe convertiría una caída de Redis en una pantalla
 * muerta, que es justo lo que este diseño no quiere ser.
 *
 * ## Lo que este flujo NO sostiene
 *
 * La interacción. Se lee **una vez** para sacar el identificador del reto, y a
 * partir de ahí sólo se sostienen el socket y una cadena. Si la referencia se
 * quedara viva dos minutos, cada conexión costaría el objeto de interacción
 * entero en vez de unos kilobytes — y con cien mil ceremonias esa diferencia
 * decide si el proceso cabe en memoria.
 *
 * ## El identificador no viaja en la URL
 *
 * No hay `/:challengeId`. El navegador no conoce ese identificador —vive en la
 * interacción, del lado del servidor, a propósito— y aquí se resuelve desde la
 * cookie, igual que en el sondeo.
 *
 * ## El latido y el `retry`
 *
 * Un comentario cada 20 s, porque los intermediarios cierran lo que calla. Y
 * cuando la suscripción muere se escribe un `retry` **aleatorio por conexión**
 * antes de cerrar: si cien mil navegadores reconectaran a la vez tendríamos la
 * estampida que el respaldo venía a evitar. El ritmo lo dicta el servidor, igual
 * que ya hace `retryAfterMs`.
 *
 * ## Por qué en su propio fichero
 *
 * Porque `te-channel.ts` ya rozaba el tope de líneas del proyecto, y porque un
 * parche del fork que vive aparte se rebasa contra upstream sin conflicto.
 */
export const registrarEventosTe = <T extends ExperienceInteractionRouterContext>(
  router: Router<unknown, T>,
  prefijo: string,
  provider: Parameters<typeof leerEstadoCanal>[1]
): void => {
  router.get(`${prefijo}/events`, async (ctx, next) => {
    rechazarAlta(ctx.experienceInteraction.interactionEvent);

    const estado = await leerEstadoCanal(ctx, provider);
    const id = estado?.canal === 'push' ? estado.challengeId : estado?.sessionId;

    if (id === undefined) {
      // Todavía no hay nada que escuchar. El sondeo cubre este hueco.
      ctx.status = 204;

      return next();
    }

    const flujo = new PassThrough();

    ctx.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Sin esto algunos intermediarios acumulan la respuesta y no entregan nada
      // hasta cerrarla, que para un flujo de eventos es no entregar nada.
      'x-accel-buffering': 'no',
    });
    ctx.status = 200;
    ctx.body = flujo;

    const escribir = (texto: string) => {
      if (!flujo.destroyed) {
        flujo.write(texto);
      }
    };

    const latido = setInterval(() => {
      escribir(': latido\n\n');
    }, 20_000);
    // Que un flujo abierto no impida al proceso apagarse.
    latido.unref();

    const dejarDeEscuchar = escucharReto(id, (evento) => {
      escribir(`data: ${JSON.stringify({ estado: evento.estado })}\n\n`);
    });

    const dejarDeVigilar = alMorirEventosTe(() => {
      // Reparte las reconexiones en vez de soltarlas todas a la vez.
      escribir(`retry: ${5000 + Math.floor(Math.random() * 25_000)}\n\n`);
      flujo.end();
    });

    const limpiar = () => {
      clearInterval(latido);
      dejarDeEscuchar();
      dejarDeVigilar();
    };

    flujo.on('close', limpiar);
    ctx.req.on('close', limpiar);

    return next();
  });
};
