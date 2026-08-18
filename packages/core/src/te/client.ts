import { z, type ZodType } from 'zod';

import { type ConfigTe } from './config.js';
import { TeChannelError } from './errors.js';
import { construirCabecerasFirma } from './hmac.js';
import {
  confirmacionGuard,
  interruptoresApagados,
  interruptoresCanalGuard,
  listaDispositivosGuard,
  retoPushGuard,
  sesionQrGuard,
  sondeoPushTeApiGuard,
  sondeoTeApiGuard,
  transaccionGuard,
  type AplicacionRp,
  type DespachoTeApi,
  type InterruptoresCanal,
  type MarcoCanal,
} from './types.js';

/**
 * Cliente servidor-a-servidor hacia te-api.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL NAVEGADOR NUNCA EMITE UNA PETICIÓN HACIA te-api. Ni `fetch`, ni WebSocket,
 * ni `<img>`, ni navegación. La CSP de la experiencia **no** lleva el origen de
 * te-api en `connect-src`, y añadirlo es un error, no una comodidad. Este
 * fichero es el único sitio del árbol desde el que se habla con te-api.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué esto no puede colgar la Experience API
 *
 * Tres frenos, en este orden:
 *
 * 1. **Corte duro por petición** (`AbortSignal.timeout`). te-api lento no se convierte en handlers
 *    de Koa lentos.
 * 2. **Tope de peticiones en vuelo**. Al superarlo se rechaza en el acto en vez de encolar: encolar
 *    convierte una ralentización de te-api en un consumo creciente de memoria y sockets aquí, que
 *    es precisamente el fallo que se quiere evitar. Rechazar sale como el error uniforme del canal
 *    y el navegador reintenta en el siguiente sondeo.
 * 3. **Cortacircuitos**. Tras N fallos seguidos deja de intentarlo durante un rato. Sin esto, con
 *    te-api caído cada sondeo de cada pestaña abriría una conexión que sólo puede acabar en
 *    timeout, y el coste de la caída lo pagaría Logto multiplicado por el número de pestañas.
 */

type Peticion = {
  metodo: 'GET' | 'POST';
  ruta: string;
  cuerpo?: unknown;
};

/** Rutas s2s de te-api. Ninguna la conoce el navegador. */
const rutas = {
  canales: '/v1/s2s/channels',
  transacciones: '/v1/s2s/oauth/transactions',
  sesionesQr: '/v1/s2s/qr/sessions',
  sesionQr: (sessionId: string) => `/v1/s2s/qr/sessions/${encodeURIComponent(sessionId)}`,
  retosPush: '/v1/s2s/push/challenges',
  dispositivosPush: '/v1/s2s/push/devices',
  retoPush: (challengeId: string) => `/v1/s2s/push/challenges/${encodeURIComponent(challengeId)}`,
} as const;

type ContextoNavegador = {
  /**
   * IP real del navegador, medida por Logto (NW-1).
   *
   * Es imprescindible pasarla: con el proxy, todas las peticiones llegan a te-api desde la IP de
   * salida de Logto. Sin este campo, `te.oauth_txn.browser_ip_24` guardaría la IP del centro de
   * datos y la cartera enseñaría «te están intentando entrar desde el centro de datos», que es
   * peor que no enseñar nada: rompe la única pregunta que la pantalla de aprobación le hace a la
   * persona, «¿estoy delante de ese ordenador?».
   */
  ip: string;
  userAgent?: string;
};

export class TeApiClient {
  #enVuelo = 0;
  #fallosSeguidos = 0;
  #abiertoHasta = 0;
  #interruptores?: { valor: InterruptoresCanal; expira: number };

  constructor(private readonly config: ConfigTe) {}

  /**
   * Interruptores de canal, cacheados con TTL corto.
   *
   * Si te-api no contesta se devuelve todo apagado (fail-closed) y **no** se cachea el fallo: la
   * experiencia deja de ofrecer el canal en cuanto te-api se cae, y lo vuelve a ofrecer en cuanto
   * responde, sin esperar a que expire nada.
   */
  async interruptores(): Promise<InterruptoresCanal> {
    const ahora = Date.now();

    if (this.#interruptores && this.#interruptores.expira > ahora) {
      return this.#interruptores.valor;
    }

    try {
      const valor = await this.#llamar(
        { metodo: 'GET', ruta: rutas.canales },
        interruptoresCanalGuard
      );

      this.#interruptores = { valor, expira: ahora + this.config.ttlInterruptoresMs };

      return valor;
    } catch {
      return interruptoresApagados;
    }
  }

  /**
   * Abre la transacción OAuth en te-api a partir de la URL de autorización que ya construyó el
   * conector social. Los parámetros (`client_id`, `state`, `code_challenge`, `redirect_uri`…) son
   * los del conector, sin tocar: `redirect_uri` se sigue comparando byte a byte en te-api (CN-4)
   * aunque ya nadie navegue a él, y cambiarlo por un valor de fantasía rompería `/oauth/token`.
   */
  async crearTransaccion(
    urlAutorizacion: string,
    navegador: ContextoNavegador,
    loginHint?: string,
    rp?: AplicacionRp
  ): Promise<{ txnId: string; expiresAt: string }> {
    const { searchParams } = new URL(urlAutorizacion);

    return this.#llamar(
      {
        metodo: 'POST',
        ruta: rutas.transacciones,
        cuerpo: {
          /**
           * El identificador viaja **dentro de `authorize`, como `login_hint`**, y no como un campo
           * hermano: te-api lo lee de los parámetros de autorización (`PARAMETROS_CONOCIDOS` en
           * `src/oauth/transaccion.ts`) y guarda sólo su huella HMAC, nunca el valor en claro. Un
           * campo hermano lo descartaría el esquema en silencio y el reto push nacería siempre
           * señuelo — es decir, el push nunca llegaría a ningún teléfono y la pantalla se quedaría
           * esperando sin que nada lo dijera.
           */
          authorize: {
            ...Object.fromEntries(searchParams.entries()),
            ...(loginHint === undefined ? {} : { login_hint: loginHint }),
          },
          browser: navegador,
          /**
           * La RP sí es un campo hermano, y **tiene** que serlo: dentro de `authorize` te-api la
           * registraría como parámetro desconocido y la tiraría, porque los de ahí dentro son los
           * del conector y `client_id` ya está ocupado por el de Logto. Son dos espacios de nombres
           * distintos —el cliente OAuth de te-api y la aplicación de Logto— y mezclarlos es
           * exactamente el error que hace que la cartera enseñe «Logto».
           *
           * Se omite entera cuando no hay nada que decir, en vez de mandarla vacía: así te-api
           * distingue «este Logto no sabe de RP» de «esta RP no tiene nombre», y cae a su cliente
           * OAuth sólo en el primer caso.
           */
          ...(rp === undefined ? {} : { rp }),
        },
      },
      transaccionGuard
    );
  }

  async crearSesionQr(txnId: string, channelHash: string) {
    return this.#llamar(
      { metodo: 'POST', ruta: rutas.sesionesQr, cuerpo: { txnId, channelHash } },
      sesionQrGuard
    );
  }

  async rotarCodigo(sessionId: string, credenciales: CredencialesCanal) {
    return this.#llamar(
      {
        metodo: 'POST',
        ruta: `${rutas.sesionQr(sessionId)}/codes`,
        cuerpo: credenciales,
      },
      sesionQrGuard.shape.code
    );
  }

  async estadoSesionQr(sessionId: string, credenciales: CredencialesCanal): Promise<MarcoCanal> {
    const { frame } = await this.#llamar(
      { metodo: 'POST', ruta: `${rutas.sesionQr(sessionId)}/state`, cuerpo: credenciales },
      sondeoTeApiGuard
    );

    return frame;
  }

  /**
   * Confirma la sesión y recibe la URL de retorno con el `code` OAuth2 **en el servidor**. El
   * llamante la consume y la destruye; no puede cruzar al navegador.
   */
  async confirmarSesionQr(sessionId: string, credenciales: CredencialesCanal) {
    return this.#llamar(
      { metodo: 'POST', ruta: `${rutas.sesionQr(sessionId)}/confirm`, cuerpo: credenciales },
      confirmacionGuard
    );
  }

  /** Despacha el push. Sin `deviceRef`, te-api elige el dispositivo elegible más reciente. */
  async despacharPush(txnId: string, deviceReference?: string) {
    return this.#llamar(
      {
        metodo: 'POST',
        ruta: rutas.retosPush,
        cuerpo: { txnId, ...(deviceReference === undefined ? {} : { deviceRef: deviceReference }) },
      },
      retoPushGuard
    );
  }

  /**
   * Sondeo del push. Devuelve el marco **y a dónde fue el aviso**.
   *
   * `dispatch` viene `null` mientras te-api no ha despachado: su trabajador de fondo es quien
   * resuelve el identificador, y lo hace fuera del ciclo de petición justo para que la latencia
   * del despacho no diga si la cuenta existe (PU-4). Por eso la etiqueta llega por aquí y no en
   * la respuesta de `despacharPush`, que se emite antes de que haya destino que nombrar.
   */
  async estadoPush(
    challengeId: string,
    txnId: string
  ): Promise<{ frame: MarcoCanal; despacho?: DespachoTeApi }> {
    const { frame, dispatch } = await this.#llamar(
      { metodo: 'POST', ruta: `${rutas.retoPush(challengeId)}/state`, cuerpo: { txnId } },
      sondeoPushTeApiGuard
    );

    // Sale tal cual llegó. Quien lo recorta es la ruta, con `enmascararDespacho`, en el mismo
    // sitio y por la misma razón que recorta la lista de dispositivos: la frontera hacia el
    // navegador es una sola y está donde se escribe `ctx.body`.
    return { frame, ...(dispatch ? { despacho: dispatch } : {}) };
  }

  /** Igual que {@link confirmarSesionQr}: el `code` se queda en este servidor. */
  async confirmarRetoPush(challengeId: string, txnId: string) {
    return this.#llamar(
      { metodo: 'POST', ruta: `${rutas.retoPush(challengeId)}/confirm`, cuerpo: { txnId } },
      confirmacionGuard
    );
  }

  /**
   * Lista de dispositivos elegibles. **La política de elegibilidad la impone te-api**: qué cuenta
   * como abandonado, desactivado o revocado, la deduplicación por instalación y el orden por más
   * reciente son invariantes de su consulta, no filtros de este cliente. Un filtro en el cliente no
   * es un filtro: se olvida en la segunda llamada.
   */
  async listarDispositivos(txnId: string, challengeId: string, eager = false) {
    return this.#llamar(
      {
        metodo: 'POST',
        ruta: rutas.dispositivosPush,
        cuerpo: {
          txnId,
          challengeId,
          /**
           * El opt-in del tenant tiene que **cruzar**. te-api también mantiene el selector cerrado
           * hasta que un reto real ha fallado, así que sin este campo `TE_PUSH_DEVICE_PICKER=eager`
           * abría la puerta de Logto y se estrellaba contra la de te-api: la bandera existía y no
           * hacía nada. El coste de encenderla está escrito al lado de la bandera, en `config.ts`.
           */
          ...(eager ? { eager: true } : {}),
        },
      },
      listaDispositivosGuard
    );
  }

  async #llamar<T>(peticion: Peticion, guard: ZodType<T>): Promise<T> {
    const ahora = Date.now();

    if (this.#abiertoHasta > ahora) {
      throw new TeChannelError('cortacircuitos abierto');
    }

    if (this.#enVuelo >= this.config.maxEnVuelo) {
      throw new TeChannelError(`contrapresión: ${this.#enVuelo} peticiones en vuelo`);
    }

    this.#enVuelo += 1;

    try {
      const resultado = await this.#enviar(peticion, guard);
      this.#fallosSeguidos = 0;
      return resultado;
    } catch (error: unknown) {
      this.#anotarFallo();
      throw error;
    } finally {
      this.#enVuelo -= 1;
    }
  }

  async #enviar<T>(peticion: Peticion, guard: ZodType<T>): Promise<T> {
    const { metodo, ruta } = peticion;
    // El cuerpo se serializa una sola vez: firmar una cadena y enviar otra es la forma clásica de
    // que la firma no cuadre por una diferencia de orden de claves.
    const cuerpo = peticion.cuerpo === undefined ? '' : JSON.stringify(peticion.cuerpo);
    const clave = this.config.claves.find(({ kid }) => kid === this.config.kidActivo);

    if (!clave) {
      throw new TeChannelError('no hay clave HMAC activa');
    }

    const respuesta = await fetch(`${this.config.baseUrl}${ruta}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        ...construirCabecerasFirma({ clave, metodo, ruta, cuerpo }),
      },
      ...(cuerpo === '' ? {} : { body: cuerpo }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
      // Sin redirecciones: te-api no redirige, y seguir una sería seguir a donde diga la respuesta.
      redirect: 'error',
    }).catch((error: unknown) => {
      throw new TeChannelError(`te-api inalcanzable: ${String(error)}`);
    });

    const texto = await respuesta.text().catch(() => '');
    const datos: unknown = texto === '' ? {} : JSON.parse(texto);

    if (!respuesta.ok) {
      throw new TeChannelError(
        `te-api respondió ${respuesta.status} en ${metodo} ${ruta}`,
        extraerRequestId(datos)
      );
    }

    const analizado = guard.safeParse(datos);

    if (!analizado.success) {
      throw new TeChannelError(`respuesta de te-api fuera de contrato en ${ruta}`);
    }

    return analizado.data;
  }

  #anotarFallo() {
    this.#fallosSeguidos += 1;

    if (this.#fallosSeguidos >= this.config.fallosParaAbrir) {
      this.#abiertoHasta = Date.now() + this.config.reposoCortacircuitosMs;
      this.#fallosSeguidos = 0;
    }
  }
}

/**
 * Credenciales del canal en cada llamada s2s.
 *
 * Dos cerraduras, como antes: el secreto del canal (lo que era la cookie `__Host-te_ch`) y el
 * verifier que sólo tiene el navegador que abrió la sesión. El verifier llega a Logto por la
 * cabecera `X-Channel-Verifier` y **jamás por el query ni por el path**: ST-1 sigue valiendo
 * aunque el salto sea a nuestro propio servidor, porque el registro de acceso de Logto y su APM
 * son igual de reales que los de te-api.
 */
type CredencialesCanal = {
  channelSecret: string;
  verifier: string;
};

const requestIdGuard = z.object({ requestId: z.string() });

const extraerRequestId = (datos: unknown): string | undefined => {
  const analizado = requestIdGuard.safeParse(datos);

  return analizado.success ? analizado.data.requestId : undefined;
};

/**
 * Un cliente por origen de te-api, memoizado. Uno solo y compartido a propósito: el tope de
 * peticiones en vuelo y el cortacircuitos sólo sirven de algo si son globales al proceso. Un cliente
 * nuevo por petición los convertiría en decoración.
 */
const clientes = new Map<string, TeApiClient>();

export const clienteTe = (config: ConfigTe): TeApiClient => {
  const existente = clientes.get(config.baseUrl);

  if (existente) {
    return existente;
  }

  const nuevo = new TeApiClient(config);
  clientes.set(config.baseUrl, nuevo);

  return nuevo;
};
