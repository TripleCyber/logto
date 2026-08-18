import { useCallback, useEffect, useRef } from 'react';

/**
 * «¿Sigue montada la pantalla?», como función y no como `ref` leída a pelo.
 *
 * El canal hace trabajo asíncrono largo —abrir, sondear en cadena, confirmar— y cada `await` es
 * un punto donde la persona puede haber navegado a otro sitio. Escribir estado de React después
 * de eso es un aviso en consola en desarrollo y una fuga de trabajo en producción, así que hay
 * que preguntar antes de cada `set*`.
 *
 * Va envuelto en una función por un motivo práctico: al leer `ref.current` directamente en un
 * cierre, el análisis de flujo de TypeScript lo da por constante y las comprobaciones se
 * denuncian como condiciones que sobran. Detrás de una llamada, el valor es el del momento en
 * que se pregunta, que es exactamente lo que se quiere decir.
 */
const useIsMounted = () => {
  const montado = useRef(true);

  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation
    montado.current = true;

    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation
      montado.current = false;
    };
  }, []);

  return useCallback((): boolean => montado.current, []);
};

export default useIsMounted;
