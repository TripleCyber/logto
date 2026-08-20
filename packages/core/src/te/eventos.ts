import { createClient } from 'redis';
import { z } from 'zod';

import { EnvSet } from '#src/env-set/index.js';

/**
 * LOGTO PATCH(te-senalizacion): el timbre de te-api, por Redis.
 *
 * ## Qué es y qué NO es
 *
 * Es una **señal de «ve a preguntar»**, no una autorización. Cuando llega un
 * mensaje, lo único que hace Logto es despertar al navegador; quien decide es
 * `confirm`, que va por el sobre firmado y acaba en una transacción de Postgres.
 *
 * Si el mensaje se pierde, se retrasa o llega falsificado, el peor desenlace es
 * que alguien llame a `confirm` antes de tiempo y reciba el fallo uniforme.
 * Nunca que entre nadie. Esa propiedad es la que permite que este canal exista
 * al lado del sobre firmado sin debilitarlo.
 *
 * ## Un solo canal, y enrutado en memoria
 *
 * Un canal por reto serían cien mil suscripciones y su churn de altas y bajas.
 * Con uno solo, cada instancia mantiene **una** suscripción permanente y reparte
 * en memoria; el caudal —un mensaje diminuto por aprobación— es irrelevante al
 * lado de eso. `SPUBLISH` de Redis 7 es la salida el día que deje de serlo.
 *
 * ## El contrato está versionado a propósito
 *
 * Entre te-api y Logto sólo había un contrato: el sobre firmado, con guardas
 * tipadas. Éste es el segundo. Sin versión ni guarda se pudre en silencio —
 * alguien cambia la forma en te-api, aquí nadie se entera, y el síntoma es un
 * navegador colgado que no se atribuye a esto. **Lo que no se entienda se
 * descarta sin ruido**, que es lo contrario de reventar.
 *
 * ## Una conexión aparte, y no es un detalle de pool
 *
 * Una conexión suscrita a Redis **no puede ejecutar comandos**: es del
 * protocolo, no una cuestión de estilo. Por eso este módulo abre la suya y no
 * toca la del caché.
 */

const eventoGuard = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  estado: z.enum(['approved', 'rejected', 'expired']),
});

type EventoTe = z.infer<typeof eventoGuard>;

/** El mismo nombre que publica te-api. Si cambia uno, deja de sonar el timbre. */
const CANAL = 'te:eventos';

type Oyente = (evento: EventoTe) => void;

const oyentes = new Map<string, Set<Oyente>>();

/**
 * El estado del módulo en un objeto y no en dos `let`: el proyecto prohíbe `let`
 * de nivel superior, y agrupar deja además un solo sitio que mirar.
 */
const estado: { cliente?: ReturnType<typeof createClient>; vivo: boolean } = {
  vivo: false,
};
/** Los que esperan a que la suscripción muera, para poder cerrar sus flujos. */
const alMorir = new Set<() => void>();

/**
 * Arranca la suscripción. Idempotente y **nunca lanza**.
 *
 * Que Redis no esté no puede impedir que Logto sirva: sin timbre, el sondeo de
 * respaldo del navegador sigue funcionando exactamente como antes. Por eso todo
 * lo de aquí abajo se traga sus errores y se limita a dejar `vivo` en `false`.
 */
export const arrancarEventosTe = async (): Promise<void> => {
  if (estado.cliente !== undefined) {
    return;
  }

  const { redisUrl } = EnvSet.values;
  if (!redisUrl) {
    return;
  }

  try {
    const suscriptor = createClient({ url: redisUrl });
    // eslint-disable-next-line @silverhand/fp/no-mutation
    estado.cliente = suscriptor;

    suscriptor.on('error', () => {
      // Silencio deliberado: un log por reintento inunda el diario justo cuando
      // hace falta leerlo. Lo que importa es `vivo`, y de eso se encargan los
      // manejadores de abajo.
    });
    suscriptor.on('ready', () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      estado.vivo = true;
    });
    suscriptor.on('end', () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      estado.vivo = false;
      for (const avisar of alMorir) {
        avisar();
      }
    });

    await suscriptor.connect();
    await suscriptor.subscribe(CANAL, (mensaje: string) => {
      const analizado = eventoGuard.safeParse(trySafeJson(mensaje));
      if (!analizado.success) {
        // Versión o forma desconocidas: se descarta. Ver la cabecera.
        return;
      }
      for (const oyente of oyentes.get(analizado.data.id) ?? []) {
        oyente(analizado.data);
      }
    });
    // eslint-disable-next-line @silverhand/fp/no-mutation
    estado.vivo = true;
  } catch {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    estado.vivo = false;
  }
};

/**
 * En qué estado quedó la suscripción, para la línea de arranque.
 *
 * «Funciona pero sin timbre» es indistinguible de «funciona» desde fuera: el
 * navegador sondea igual y la ceremonia termina igual, sólo que cuatro segundos
 * más tarde — y para siempre. Sin esta línea, una URL mal puesta se descubre
 * dentro de un mes o nunca.
 *
 * Tres estados y no dos, porque significan cosas distintas: no configurado es
 * una decisión de despliegue legítima; configurado y mudo es un error de hoy.
 */
export const describirEventosTe = (): string => {
  if (!EnvSet.values.redisUrl) {
    return 'no configurado';
  }

  return estado.vivo ? 'conectado' : 'CONFIGURADO PERO NO RESPONDE';
};

/** Escucha los eventos de un reto. Devuelve cómo dejar de escuchar. */
export const escucharReto = (id: string, oyente: Oyente): (() => void) => {
  const conjunto = oyentes.get(id) ?? new Set<Oyente>();
  conjunto.add(oyente);
  oyentes.set(id, conjunto);

  return () => {
    conjunto.delete(oyente);
    if (conjunto.size === 0) {
      oyentes.delete(id);
    }
  };
};

/** Avisa cuando la suscripción muera, para que los flujos abiertos se cierren. */
export const alMorirEventosTe = (avisar: () => void): (() => void) => {
  alMorir.add(avisar);
  return () => alMorir.delete(avisar);
};

const trySafeJson = (texto: string): unknown => {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
};
