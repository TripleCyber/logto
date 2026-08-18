import { useEffect, useRef, useState } from 'react';

/**
 * ¿Está este nodo realmente pintado, o lo ha escondido el CSS?
 *
 * ## Por qué existe
 *
 * La columna del código se enseña o se esconde con `@media (min-width: 820px)`. Escondida sigue
 * **montada**: `display: none` es una decisión de pintura, no de React. Sin esto, cada carga de la
 * pantalla de acceso en un móvil abriría un canal contra te-api y se pondría a sondearlo para no
 * enseñar nada — una sesión de servidor, una cadena de peticiones y batería, por una columna que
 * nadie ve.
 *
 * ## Por qué se observa el nodo y no se repite la media query
 *
 * La tentación es un `matchMedia('(min-width: 820px)')`. Funciona, y deja el número 820 escrito en
 * dos sitios: el día que la maqueta cambie a 880, uno de los dos se quedará atrás y el fallo será
 * «a veces el código no carga en ventanas medianas», que no se parece en nada a su causa.
 *
 * Observar el nodo **lee la decisión del CSS** en vez de duplicarla. Un elemento con `display:
 * none` no genera ninguna caja, así que `IntersectionObserver` lo reporta como no intersectante
 * sin más configuración: la media query sigue siendo la única que decide.
 *
 * `rootMargin` enorme a propósito: lo que se quiere saber es «¿existe como caja?», no «¿está en
 * la parte visible del scroll?». Sin él, una ventana muy baja que dejara la tarjeta fuera de
 * pantalla cerraría el canal a media sesión.
 *
 * Sin `IntersectionObserver` —jsdom, navegadores viejos— se responde que sí: el coste de abrir un
 * canal que no se ve es mucho menor que el de no abrir el que sí se ve.
 */
const useEstaVisible = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [estaVisible, setEstaVisible] = useState(false);

  useEffect(() => {
    const nodo = ref.current;

    if (!nodo) {
      return;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setEstaVisible(true);

      return;
    }

    const observador = new IntersectionObserver(
      ([entrada]) => {
        setEstaVisible(Boolean(entrada?.isIntersecting));
      },
      { rootMargin: '100000px' }
    );

    observador.observe(nodo);

    return () => {
      observador.disconnect();
    };
  }, []);

  return { ref, estaVisible };
};

export default useEstaVisible;
