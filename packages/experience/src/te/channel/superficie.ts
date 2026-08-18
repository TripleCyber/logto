import { type TFuncKey } from 'i18next';

import { type FaseCanal } from './fases';
import { reiniciarAcceso } from './reinicio';

/**
 * Las tres preguntas que se hacen las dos superficies del QR —la columna del acceso y la pantalla
 * propia— para decidir qué dibujan.
 *
 * Estaban escritas dos veces, una en cada componente, y con el mismo nombre (`terminado`) para dos
 * listas que ya empezaban a divergir. Aquí hay una sola respuesta por pregunta, y por eso una fase
 * nueva no puede volver a entrar en una superficie y olvidarse de la otra.
 */

/**
 * ¿Se acabó el canal? Es lo que decide si el último código se vela (F1).
 *
 * `sinRed` **no** entra: un corte de red no mata el canal, y el código que hay en pantalla puede
 * seguir sirviendo cuando la conexión vuelva. Velarlo sería apagar algo que todavía está vivo.
 */
export const canalMuerto = (fase: FaseCanal): boolean =>
  fase === 'rechazado' || fase === 'caducado' || fase === 'fallo' || fase === 'sesionCaducada';

/**
 * ¿Hay algo que la persona pueda pulsar para volver a intentarlo?
 *
 * Incluye `sinRed`, y ése es el arreglo: la pantalla decía «Sin conexión. Reintentando…» y **no
 * ofrecía nada**, con lo que cuando el fallo había ocurrido al abrir —y por tanto no había ninguna
 * cadena de sondeo reintentando— sólo se salía recargando el navegador. Ahora la reapertura
 * automática hace verdadera la frase, y el botón está igualmente para quien no quiera esperar.
 *
 * `sesionCaducada` queda fuera a propósito: ahí no hay nada que reintentar y su salida es otra.
 */
export const hayReintento = (fase: FaseCanal): boolean =>
  fase === 'sinRed' || (canalMuerto(fase) && fase !== 'sesionCaducada');

/**
 * ¿Hay que empezar el acceso de nuevo?
 *
 * Sólo con la interacción de Logto caducada. No es un fallo del canal y no se arregla pidiendo otro
 * código: hace falta un login nuevo, y eso es una navegación, no una petición. Ver `FaseCanal`.
 */
export const pideEmpezarDeNuevo = (fase: FaseCanal): boolean => fase === 'sesionCaducada';

/**
 * Qué dice y qué hace el velo que cubre el código muerto.
 *
 * Está aquí y no en cada componente porque las dos superficies tienen que decidirlo **igual**: si
 * una ofreciera «pedir otro código» con el login caducado, ofrecería una acción que no puede
 * funcionar, que es exactamente el fallo que se venía a arreglar.
 */
export const accionDelVelo = (
  fase: FaseCanal,
  reintentar: () => Promise<void>
): { readonly clave: TFuncKey; readonly ejecutar: () => void } =>
  pideEmpezarDeNuevo(fase)
    ? { clave: 'te.action.restart', ejecutar: reiniciarAcceso }
    : {
        clave: 'te.action.new_code',
        ejecutar: () => {
          void reintentar();
        },
      };
