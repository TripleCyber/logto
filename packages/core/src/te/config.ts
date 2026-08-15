/**
 * Configuración del canal TripleEnable en el servidor de Logto.
 *
 * Por qué existe este módulo y no una entrada en `GlobalValues`: `GlobalValues` vive en
 * `@logto/shared`, que comparten consola, experiencia y CLI. El secreto HMAC con el que Logto se
 * autentica ante te-api no tiene por qué existir en ninguno de esos procesos, y meterlo en un
 * paquete compartido es la forma más fácil de que acabe empaquetado en un bundle de navegador.
 * Aquí se lee de `process.env` en el único proceso que lo necesita.
 *
 * **El secreto nunca está en el árbol.** No hay valor por defecto, no hay fichero de ejemplo con
 * una clave real y no hay fallback «de desarrollo»: sin `TE_LOGTO_HMAC_KEYS` el canal queda
 * apagado (ver {@link cargarConfigTe}). Un valor por defecto que funcione es un valor por defecto
 * que se despliega.
 */

/** Objetivo (`target`) del conector social de TripleEnable. Un solo conector, dos canales. */
export const objetivoConectorTe = 'tripleenable';

/**
 * Política del selector de dispositivos (PU-12).
 *
 * - `lazy` (por defecto): el primer push va al dispositivo más reciente **sin enseñar lista**.
 *   La lista sólo se abre tras un reto fallido o caducado.
 * - `eager`: la lista enmascarada se puede pedir antes del primer despacho.
 *
 * COSTE DE `eager`, escrito aquí al lado de la bandera y no en un documento aparte: cualquiera que
 * teclee el identificador de la víctima obtiene el perfil de su flota (hasta 5 entradas, categoría
 * y antigüedad en cubetas) SIN gastar ningún push y SIN dejar rastro en la pantalla de bloqueo del
 * titular. Deja de haber evento de detección. Es exactamente PU-12 sin mitigación.
 * No activar sin decisión explícita del dueño.
 */
type PoliticaSelectorDispositivos = 'lazy' | 'eager';

export type ClaveHmacTe = {
  kid: string;
  secreto: Uint8Array;
};

export type ConfigTe = {
  /** Origen interno de te-api. El navegador no lo conoce y no debe conocerlo nunca. */
  baseUrl: string;
  /** Claves activas, en orden. Se firma siempre con la primera salvo `TE_HMAC_ACTIVE_KID`. */
  claves: readonly ClaveHmacTe[];
  /** `kid` con el que se firma. Siempre presente si hay claves. */
  kidActivo: string;
  /** Corte duro de cada petición s2s. te-api caído no puede colgar la Experience API. */
  timeoutMs: number;
  /** Tope de peticiones s2s simultáneas. Al superarlo se rechaza en el acto, no se encola. */
  maxEnVuelo: number;
  /** Fallos consecutivos que abren el cortacircuitos. */
  fallosParaAbrir: number;
  /** Tiempo que el cortacircuitos permanece abierto. */
  reposoCortacircuitosMs: number;
  /** Piso de latencia de los errores del canal. Nivela las ramas de fallo entre sí. */
  pisoLatenciaErrorMs: number;
  /** TTL de la caché de interruptores de canal. */
  ttlInterruptoresMs: number;
  politicaSelectorDispositivos: PoliticaSelectorDispositivos;
};

const numeroDeEntorno = (bruto: string | undefined, porDefecto: number): number => {
  if (!bruto) {
    return porDefecto;
  }

  const valor = Number.parseInt(bruto, 10);

  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
};

/**
 * Longitud mínima del secreto, en bytes. Alineada con `TE_HMAC_PEPPER` de te-api: por debajo de
 * 32 bytes la fuerza bruta del secreto deja de ser teórica y el arranque tiene que fallar en vez
 * de quedarse a medias.
 */
const longitudMinimaSecreto = 32;

/**
 * Analiza `TE_LOGTO_HMAC_KEYS` con la forma `"kid:base64,kid:base64"`.
 *
 * Dos claves activas a la vez es lo que permite rotar sin ventana de caída: se añade la nueva al
 * principio en los dos lados, se despliega Logto, se despliega te-api y se borra la vieja. El
 * mismo patrón que `TE_CLIENT_SECRET` / `TE_CLIENT_SECRET_PREVIOUS` (CN-9).
 *
 * Una entrada mal formada o corta se descarta en silencio hacia fuera pero deja el canal apagado
 * si no queda ninguna válida: preferimos «no se ofrece» a «se ofrece y falla al usarlo».
 */
export const analizarClavesHmac = (bruto: string | undefined): ClaveHmacTe[] => {
  if (!bruto) {
    return [];
  }

  return bruto
    .split(',')
    .map((entrada) => entrada.trim())
    .filter(Boolean)
    .map((entrada): ClaveHmacTe | undefined => {
      const separador = entrada.indexOf(':');

      if (separador <= 0) {
        return undefined;
      }

      const kid = entrada.slice(0, separador).trim();
      const secreto = Buffer.from(entrada.slice(separador + 1).trim(), 'base64');

      if (!kid || secreto.length < longitudMinimaSecreto) {
        return undefined;
      }

      return { kid, secreto };
    })
    .filter((clave): clave is ClaveHmacTe => clave !== undefined);
};

/**
 * Construye la configuración a partir de un entorno dado. Pura y con el entorno inyectado para
 * que los tests no tengan que mutar `process.env` global.
 *
 * Devuelve `undefined` cuando falta lo imprescindible (URL o claves). Eso **apaga el canal**:
 * `GET .../te-channel/config` responderá que ni QR ni push están disponibles y la experiencia no
 * los pintará. Es la lectura correcta del requisito «el apagado se nota en la UI, no en un 4xx al
 * usarlo», y además es fail-closed frente a un despliegue a medio configurar.
 */
export const cargarConfigTe = (entorno: NodeJS.ProcessEnv = process.env): ConfigTe | undefined => {
  const baseUrl = entorno.TE_API_BASE_URL?.trim();
  const claves = analizarClavesHmac(entorno.TE_LOGTO_HMAC_KEYS);

  if (!baseUrl || claves.length === 0) {
    return undefined;
  }

  const [primera, ...resto] = claves;

  if (!primera) {
    return undefined;
  }

  const kidPedido = entorno.TE_HMAC_ACTIVE_KID?.trim();
  const kidActivo =
    kidPedido && claves.some(({ kid }) => kid === kidPedido) ? kidPedido : primera.kid;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    claves: [primera, ...resto],
    kidActivo,
    timeoutMs: numeroDeEntorno(entorno.TE_API_TIMEOUT_MS, 3000),
    maxEnVuelo: numeroDeEntorno(entorno.TE_API_MAX_INFLIGHT, 32),
    fallosParaAbrir: numeroDeEntorno(entorno.TE_API_BREAKER_FAILURES, 5),
    reposoCortacircuitosMs: numeroDeEntorno(entorno.TE_API_BREAKER_RESET_MS, 5000),
    pisoLatenciaErrorMs: numeroDeEntorno(entorno.TE_CHANNEL_ERROR_LATENCY_MS, 300),
    ttlInterruptoresMs: numeroDeEntorno(entorno.TE_CHANNEL_CONFIG_TTL_MS, 10_000),
    politicaSelectorDispositivos:
      entorno.TE_PUSH_DEVICE_PICKER?.trim() === 'eager' ? 'eager' : 'lazy',
  };
};

/**
 * Memoización del proceso. Un `Map` y no una variable reasignable: el entorno no cambia en caliente,
 * y así el módulo no tiene estado mutable suelto.
 */
const memoria = new Map<'config', ConfigTe | undefined>();

/** Configuración del proceso. */
export const configTe = (): ConfigTe | undefined => {
  if (!memoria.has('config')) {
    memoria.set('config', cargarConfigTe());
  }

  return memoria.get('config');
};

/** Sólo para tests: olvida la memoización. */
export const olvidarConfigTe = () => {
  memoria.clear();
};
