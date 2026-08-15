/**
 * LOGTO PATCH(te-factor-choice): textos de los factores QR y push de TripleEnable.
 *
 * Sin jerga: ni «IP», ni «riesgo», ni «puntuación». Cada estado de fallo termina con algo que
 * hacer, porque quien lee esta pantalla está atascado y no quiere un diagnóstico.
 *
 * Upstream: (archivo nuevo)
 */
const te = {
  qr: {
    title: 'Escanea para entrar',
    description: 'Abre tu cartera TripleEnable y escanea este código.',
    /** Alternativa textual al propio código, para lectores de pantalla. */
    alt: 'Código de acceso para tu cartera TripleEnable. Se renueva solo cada pocos segundos.',
    no_camera: '¿No puedes escanear? Abre la cartera y entra desde ahí.',
    pair_code_label: 'Comprueba este número',
    pair_code_hint:
      'Tu cartera enseñará las mismas cuatro cifras. Si no coinciden, para y vuelve a empezar.',
    refresh_in: 'El código se renueva en {{seconds}} s',
    /**
     * LOGTO PATCH(te-signin-split): título y nota de la columna del código en la tarjeta de
     * acceso. Es lo primero que se lee, así que nombra la cosa y dice lo que cuesta —nada que
     * teclear— en vez de explicar el protocolo.
     */
    aside_title: 'Cartera TripleEnable',
    aside_note: 'Escanea el código. Sin contraseña, nada que teclear.',
  },
  push: {
    title: 'Apruébalo en tu móvil',
    description: 'Hemos enviado un aviso a tu dispositivo. Apruébalo ahí para continuar.',
    match_label: 'Teclea estas cifras en el móvil',
    match_hint: 'Solo aparecen aquí; nunca viajan en el aviso.',
    another_device: 'Usar otro dispositivo',
    devices_title: 'Elige un dispositivo',
    devices_description: 'Escoge a cuál enviamos el aviso.',
    device_phone: 'Teléfono',
    device_tablet: 'Tableta',
    device_desktop: 'Ordenador',
    last_seen_today: 'visto hoy',
    last_seen_this_week: 'visto esta semana',
    last_seen_older: 'visto hace tiempo',
    device_option: '{{kind}} · {{lastSeen}}',
    send_here: 'Enviar aquí',
  },
  method: {
    qr_title: 'Escanear un código',
    qr_description: 'Entra con tu cartera TripleEnable escaneando un código.',
    push_title: 'Aprobar en el móvil',
    push_description: 'Recibe un aviso en tu dispositivo y apruébalo ahí.',
  },
  status: {
    waiting: 'Esperando a tu cartera…',
    scanned: 'Código leído. Termina en el móvil.',
    approving: 'Ya casi está…',
    rejected: 'Se rechazó la solicitud. Puedes volver a intentarlo.',
    expired: 'Ha pasado demasiado tiempo. Empieza de nuevo cuando quieras.',
    failed: 'No se ha confirmado el acceso. Prueba otro método.',
    offline: 'Sin conexión. Reintentando…',
    /**
     * LOGTO PATCH(te-signin-split): lo que dice un canal muerto cuando **nadie ha escaneado**.
     *
     * `failed` afirma que el acceso no se confirmó, y eso habla de un intento que ocurrió. Antes
     * de que el canal en vivo avise de un escaneo no hay intento, así que decirlo es falso y
     * además alarma: quien lee está mirando un código que no ha tocado. Éste dice el único hecho
     * disponible —el código no sirve— y termina con lo único que se puede hacer.
     */
    unavailable: 'Este código no está listo. Vuelve a intentarlo.',
  },
  action: {
    retry: 'Reintentar',
    other_method: 'Usar otro método',
  },
};

export default Object.freeze(te);
