import { type MutableRefObject, useCallback } from 'react';

import { ritmoInicialMs, ritmoSinRedMs } from './config';
import { clasificarFallo, type FaseCanal } from './fases';
import { esTerminal, type EstadoCanal } from './machine';

/**
 * **La cadena de sondeos, y cómo se muere.**
 *
 * Vive fuera de `use-te-channel` por la misma razón que `use-rotacion`: allí está qué se cree de lo
 * que llega y aquí sólo **cuándo se vuelve a preguntar y qué se hace cuando la pregunta falla**.
 *
 * ## Cadena, no intervalo
 *
 * Con `setInterval` y un `await` dentro, una respuesta lenta solapa peticiones, `clearInterval` no
 * cancela la que está en vuelo y el paso a `aprobado` puede ejecutarse dos veces. La cadena no
 * puede solaparse por construcción: la siguiente vuelta se programa cuando la anterior ha
 * terminado.
 *
 * ## La generación: **una cadena se cancela, no se espera a que se muera sola**
 *
 * Antes esto lo guardaba un booleano —«hay una cadena viva»— que no sabía decir de quién. Con un
 * corte de red la cadena queda DORMIDA cuatro segundos, no muerta, así que el booleano seguía
 * diciendo que sí: reabrir el canal no arrancaba ninguna cadena nueva, y la vieja despertaba
 * después para sondear una sesión que ya no era la de la pantalla. Ése es el fallo que se veía
 * como «la pantalla se queda tonta hasta que refrescas».
 *
 * Ahora cada apertura estrena generación, la cadena se queda con la suya y la comprueba en cada
 * punto de espera: al despertar, la vieja ve que ya no manda y se aparta sin tocar nada.
 * `sondeoActivo` guarda la generación de la cadena viva —0 si no hay ninguna— y es lo que conserva
 * la propiedad que el booleano sí tenía: dos arranques de la MISMA generación no abren dos cadenas.
 */

type Opciones = {
  /** Una vuelta. Devuelve los ms hasta la siguiente, o `undefined` para parar. */
  readonly unaVuelta: () => Promise<number | undefined>;
  /** Acuña otro código. Es la última oportunidad antes de dar el canal por muerto. */
  readonly rotar: () => Promise<boolean>;
  /** ¿Sigue mandando esta generación? Lo decide `use-te-channel`, que es quien las reparte. */
  readonly vigente: (gen: number) => boolean;
  /** La generación de la cadena viva, o 0. Se comparte por `ref` con quien abre el canal. */
  readonly sondeoActivo: MutableRefObject<number>;
  /** Instante en el que la sesión del canal se da por agotada pase lo que pase. */
  readonly finDeSesion: MutableRefObject<number>;
  /** El estado de la máquina, que va por delante del de React. */
  readonly estadoRef: MutableRefObject<EstadoCanal>;
  readonly setFase: (fase: FaseCanal) => void;
};

const useSondeo = ({
  unaVuelta,
  rotar,
  vigente,
  sondeoActivo,
  finDeSesion,
  estadoRef,
  setFase,
}: Opciones) =>
  useCallback(
    (gen: number) => {
      if (sondeoActivo.current === gen || !vigente(gen)) {
        return;
      }

      // eslint-disable-next-line @silverhand/fp/no-mutation
      sondeoActivo.current = gen;

      /** Suelta el turno, pero sólo si sigue siendo suyo: una cadena vieja no apaga a la nueva. */
      const soltar = () => {
        if (sondeoActivo.current === gen) {
          // eslint-disable-next-line @silverhand/fp/no-mutation
          sondeoActivo.current = 0;
        }
      };

      const techoAgotado = async () => {
        /*
         * Techo absoluto: una pestaña olvidada no sondea para siempre si el servidor deja de
         * contestar del todo. La caducidad de verdad la dice el marco `expired`, así que antes de
         * rendirse se hace **una última vuelta**.
         *
         * No es cortesía: el techo se calcula desde el mismo `expiresAt` que usa el servidor, así
         * que llegaba siempre un instante antes que el marco `expired` y lo tapaba. Consecuencia
         * medida: tras un push que caduca, ni el servidor marcaba el reto como fallido ni la
         * pantalla abría el selector de dispositivos, así que «usar otro dispositivo» no aparecía
         * nunca y C3 se quedaba a medias. El desbloqueo del selector es un efecto del sondeo
         * (PU-12, se gana habiendo gastado un push real), y saltárselo era saltarse el desbloqueo.
         */
        try {
          await unaVuelta();
        } catch {
          setFase('caducado');
        }

        if (vigente(gen) && !esTerminal(estadoRef.current)) {
          setFase('caducado');
        }

        soltar();
      };

      const vuelta = async () => {
        if (!vigente(gen)) {
          soltar();

          return;
        }

        if (finDeSesion.current > 0 && Date.now() > finDeSesion.current) {
          await techoAgotado();

          return;
        }

        try {
          const espera = await unaVuelta();

          if (!vigente(gen) || espera === undefined) {
            soltar();

            return;
          }

          setTimeout(() => {
            void vuelta();
          }, espera);
        } catch (error: unknown) {
          const clase = vigente(gen) ? await clasificarFallo(error) : undefined;

          if (!vigente(gen)) {
            soltar();

            return;
          }

          // El login entero se fue: rotar el código no lo trae de vuelta, y decir «este código no
          // sirve» manda a pulsar un botón que no puede funcionar. Se dice lo que pasa y se para.
          if (clase === 'sesionCaducada') {
            setFase('sesionCaducada');
            soltar();

            return;
          }

          // Un 4xx del canal es el error uniforme: el canal ya no sirve. Un fallo sin respuesta es
          // la red, y de eso sí se vuelve solo.
          if (clase === 'sinRed') {
            setFase('sinRed');
            setTimeout(() => {
              void vuelta();
            }, ritmoSinRedMs);

            return;
          }

          /*
           * Antes de rendirse, una oportunidad: **el canal puede haberse quedado sin código sin
           * haberse muerto**. Los temporizadores de una pestaña en segundo plano se frenan a uno
           * por minuto, así que la rotación llega tarde, el código caduca del todo y el sondeo se
           * encuentra con una sesión viva de la que no se puede derivar ningún marco. Al volver a
           * la pestaña eso se veía como «este código no está listo» sin que nadie hubiera tocado
           * nada.
           *
           * Acuñar otro código es exactamente lo que falta, y la sesión —que dura mucho más que un
           * código— sigue siendo la misma. Si tampoco se puede acuñar, entonces sí: el canal está
           * muerto y se dice.
           */
          const revivido = await rotar();

          if (revivido && vigente(gen)) {
            setTimeout(() => {
              void vuelta();
            }, ritmoInicialMs);

            return;
          }

          if (vigente(gen)) {
            setFase('fallo');
          }

          soltar();
        }
      };

      void vuelta();
    },
    [estadoRef, finDeSesion, rotar, setFase, sondeoActivo, unaVuelta, vigente]
  );

export default useSondeo;
