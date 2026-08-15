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
 * Techo absoluto de una sesión de canal, en milisegundos.
 *
 * Coincide con `TE_QR_SESSION_TTL_SECONDS` del servidor. El cliente **no** decide la caducidad
 * —eso lo hace el marco `expired`—; esto sólo evita que una pestaña olvidada siga sondeando para
 * siempre si el servidor deja de responder del todo.
 */
export const techoSesionMs = 300_000;

/** Tope de dispositivos que la pantalla pinta. El servidor ya recorta; esto es cinturón. */
export const topeDispositivos = 5;
