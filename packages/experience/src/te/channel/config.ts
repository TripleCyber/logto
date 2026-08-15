/**
 * Configuración del canal TripleEnable en la experiencia.
 *
 * Un solo conector y un solo `target`. El canal —QR o push— es un **parámetro del flujo**, no una
 * identidad distinta: `target` es la clave de `users.identities`, así que dos conectores falsos
 * duplicarían la identidad del mismo usuario y obligarían a mantener dos filas sincronizadas a
 * mano. Reconocerlo por `target` y no por id es lo que mantiene la reactividad a consola sin
 * forkear la consola: es el mismo valor que la consola guarda en
 * `sign_in_experiences.social_sign_in_connector_targets`.
 */

/** El `target` del conector social de TripleEnable. Idéntico a `core/src/te/config.ts`. */
export const objetivoConectorTe = 'tripleenable';

/** Pantallas propias, registradas en `App.tsx` junto a la de passkey. */
export const rutasTe = Object.freeze({
  /** C1 en móvil: el QR en su propia pantalla de factor. */
  qr: '/sign-in/te-qr',
  /** C3: espera del push, y desde ahí la lista enmascarada. */
  push: '/sign-in/te-push',
});

/**
 * Ritmo por defecto del sondeo, en milisegundos.
 *
 * **Es sólo el arranque y el respaldo.** El ritmo real lo dicta el servidor en cada respuesta
 * (`retryAfterMs`), y `retryAfterMs === 0` es la señal de PARAR, no de sondear sin pausa. Este
 * valor se usa antes de la primera respuesta y cuando una respuesta llega sin ritmo utilizable.
 */
export const ritmoInicialMs = 1500;

/**
 * Espera tras un fallo de red antes de reintentar el sondeo.
 *
 * Más largo que el ritmo normal a propósito: si te-api o el proxy están caídos, insistir a 1,5 s
 * desde cada pestaña abierta convierte una caída en una avalancha justo cuando menos margen hay.
 */
export const ritmoSinRedMs = 4000;

/**
 * Cuántas veces se vuelve a abrir el canal **sola** la pantalla tras un corte de red.
 *
 * Existe porque «Sin conexión. Reintentando…» tenía que ser verdad. Cuando el corte pillaba a la
 * apertura —y no al sondeo— no se arrancaba ninguna cadena, así que no había nada reintentando: la
 * pantalla se quedaba con esa frase para siempre y sólo se salía con F5. Ahora la apertura se
 * reprograma sola, y el tope está para que una caída larga no convierta cada pestaña abierta en un
 * generador de tráfico. Agotado el tope se para y queda el botón, que es el reintento de la persona.
 */
export const topeReaperturas = 4;

/**
 * Techo absoluto de una sesión de canal, en milisegundos.
 *
 * Coincide con `TE_QR_SESSION_TTL_SECONDS` del servidor. El cliente **no** decide la caducidad
 * —eso lo hace el marco `expired`—; esto sólo evita que una pestaña olvidada siga sondeando para
 * siempre si el servidor deja de responder del todo.
 */
export const techoSesionMs = 300_000;

/**
 * Cuánto antes de que el código deje de pintarse se pide el siguiente, en milisegundos.
 *
 * **Quien rota es la pantalla, no el servidor.** te-api acuña un código al abrir la sesión y no
 * vuelve a acuñar ninguno por su cuenta: `POST …/state` deriva el marco de la fila, y cuando la
 * fila activa ya no existe no hay marco que derivar y la respuesta es un 4xx. Dicho de otro modo,
 * una pantalla que no rota se queda sin código a los treinta segundos y convierte una espera
 * normal en un fallo del canal. El propio módulo de rotación de te-api lo da por supuesto al
 * describir quién compite por el bloqueo: «el temporizador de la pantalla en
 * `displayExpiresAt − 2 s`».
 *
 * Dos segundos, y no cero, porque la petición tarda: pedirlo justo al expirar deja un hueco en el
 * que el código pintado ya no sirve. Y no más, porque `TE_QR_ROTATE_MIN_SECONDS` (20 s) rechaza
 * las rotaciones demasiado seguidas: con un código de 30 s, pedir el siguiente antes del segundo
 * 20 sería pedirlo para nada.
 */
export const margenRotacionMs = 2000;

/** Tope de dispositivos que la pantalla pinta. El servidor ya recorta; esto es cinturón. */
export const topeDispositivos = 5;
