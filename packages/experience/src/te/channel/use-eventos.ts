import { useEffect } from 'react';

/**
 * LOGTO PATCH(te-senalizacion): el aviso en tiempo real, **al lado del sondeo**.
 *
 * ## Lo que este hook NO hace
 *
 * No mete estado en la máquina del canal. Cuando llega un aviso, lo único que
 * hace es **disparar un sondeo ahora** en vez de esperar al temporizador. El
 * marco sigue saliendo de donde salía —del servidor, por el sobre firmado— y la
 * máquina de estados no se entera de que existe este canal.
 *
 * Esa contención es lo que hace que no pueda empeorar nada:
 *
 *  · Si el aviso no llega nunca —Redis caído, proxy que corta, pestaña en
 *    segundo plano— el sondeo sigue en su ritmo y la ceremonia funciona
 *    exactamente como antes.
 *  · Si llega un aviso de más, el coste es un sondeo de más.
 *  · Si llegara uno falsificado, el sondeo preguntaría al servidor y recibiría
 *    la verdad. El aviso no es una autorización: es un «ve a preguntar».
 *
 * ## Por qué `EventSource` y no un WebSocket
 *
 * Porque el navegador no tiene nada que decir: el canal lleva un mensaje en un
 * sentido. `EventSource` es HTTP normal —atraviesa el proxy sin upgrade— y trae
 * la reconexión de serie, con el ritmo que dicte el servidor en `retry:`.
 */
const useEventos = (activo: boolean, alAvisar: () => void): void => {
  useEffect(() => {
    if (!activo || typeof EventSource === 'undefined') {
      return;
    }

    // Sin identificador en la URL: el reto vive en la interacción, del lado del
    // servidor, y se resuelve desde la cookie igual que en el sondeo.
    const fuente = new EventSource('/api/experience/verification/te-channel/events', {
      withCredentials: true,
    });

    fuente.addEventListener('message', () => {
      alAvisar();
    });

    // Un error no se trata: `EventSource` reconecta solo, con el ritmo que el
    // servidor haya dictado. Cerrar aquí sería quitarle esa capacidad.

    return () => {
      fuente.close();
    };
  }, [activo, alAvisar]);
};

export default useEventos;
