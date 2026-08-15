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
    /**
     * LOGTO PATCH(te-push-destino): deja de afirmar un envío que todavía no ha ocurrido.
     *
     * Decía «Hemos enviado un aviso a tu dispositivo» — y en el momento en que esta pantalla
     * aparece no se ha enviado nada: el servidor resuelve el identificador en un trabajador de
     * fondo para que la latencia de la respuesta no diga si la cuenta existe (PU-4). Y decía «tu
     * dispositivo», en singular y sin decir cuál, que no ayuda a nadie. A dónde fue el aviso es
     * ahora una línea propia (`sending` / `sent_*`), dicha cuando es verdad; ésta dice qué hay
     * que hacer, que es verdad desde el primer segundo.
     */
    description: 'Apruébalo en tu cartera TripleEnable para continuar.',
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
    /**
     * LOGTO PATCH(te-push-destino): a dónde fue de verdad el aviso.
     *
     * La pantalla decía «a tu dispositivo» —en singular y sin decir a cuál—. Éstas lo dicen, con
     * la misma etiqueta enmascarada que ya pinta la lista de dispositivos: categoría gruesa y
     * cubeta temporal. Nunca el nombre que la persona le puso al aparato, nunca el modelo. Eso se
     * puede enseñar **después** de aprobar; antes, quien mira esta pantalla es sólo quien tecleó
     * un identificador.
     *
     * `sending` no es un relleno: durante unos segundos es la verdad. El servidor resuelve el
     * identificador en un trabajador de fondo, fuera del ciclo de petición, para que la latencia
     * de la respuesta no diga si la cuenta existe (PU-4) — cuando esta pantalla aparece, todavía
     * no ha salido nada.
     */
    sending: 'Enviando el aviso…',
    sent_phone: 'Enviado a tu teléfono · {{lastSeen}}',
    sent_tablet: 'Enviado a tu tableta · {{lastSeen}}',
    sent_desktop: 'Enviado a tu ordenador · {{lastSeen}}',
    /**
     * El abanico de PU-11: el aviso va a todos los elegibles. Se dice cuántos y nada más — con el
     * aviso yendo a toda la flota, «teléfono» describiría un aparato de una lista, y esa lista es
     * lo que PU-12 no entrega.
     *
     * El hueco se llama `total` y no `count` a propósito: `count` es el nombre reservado que
     * enciende la maquinaria de plurales de i18next, y esta cadena sólo se usa con dos o más.
     */
    sent_many: 'Enviado a tus {{total}} dispositivos',
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
    /**
     * LOGTO PATCH(te-canal-revive): lo que caducó es el acceso entero, no sólo el código.
     *
     * La interacción OIDC de Logto vive una hora. Pasada esa hora, TODAS las rutas de la
     * experiencia responden `404 session.not_found` —también la que reabre el canal—, así que
     * «Reintentar» no podía funcionar y la pantalla repintaba la misma en la que ya estaba. Esto
     * dice lo que de verdad pasa y señala lo único que sirve.
     */
    session_expired: 'El acceso ha tardado demasiado. Empieza de nuevo para continuar.',
  },
  action: {
    retry: 'Reintentar',
    other_method: 'Usar otro método',
    /**
     * LOGTO PATCH(te-canal-revive): el texto escrito sobre el código velado, y el nombre accesible
     * del botón en que se ha convertido el código entero. Corto, porque va encima de la cosa
     * sobre la que actúa.
     */
    new_code: 'Pedir otro código',
    /** LOGTO PATCH(te-canal-revive): recarga, y el servidor la convierte en un acceso nuevo. */
    restart: 'Empezar de nuevo',
  },
};

export default Object.freeze(te);
