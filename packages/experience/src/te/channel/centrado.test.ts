import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * F5 · **El centrado**, y lo que no se puede perder al centrar.
 *
 * ## Por qué estos tests leen CSS en vez de maquetar
 *
 * Lo que el dueño ve —la tarjeta descolocada, una columna centrada y la otra arriba— es
 * **geometría**, y jsdom no maqueta: no tiene motor de cascada, no resuelve `flex`, no evalúa
 * `@media` y devuelve 0 en todos los rectángulos. Un test de React que renderice la columna puede
 * comprobar que el nodo existe y qué dice, y eso ya lo hacen `criteria.test.tsx` y
 * `signin-split.test.tsx`; lo que no puede es comprobar dónde cae.
 *
 * La prueba de que esto se ve bien es el barrido por las seis proporciones con el navegador contra
 * el servidor de verdad, y está en el informe con las medidas de cada una. Lo que se puede
 * automatizar —y es justo lo que se rompe sin querer al tocar una hoja meses después— es que las
 * **decisiones** sigan escritas: que la tarjeta no se estire, que los dos rellenos flexibles midan
 * lo mismo, que el relleno vertical sea simétrico, y que nada de eso se haya llevado por delante el
 * `:has()` ni el interruptor de 820 px, que son las dos cosas que el encargo prohíbe romper.
 *
 * Los comentarios se quitan antes de mirar: si no, una hoja llena de explicaciones que **hablan**
 * de `align-self: center` pasaría los tests sin tener la regla.
 */

/*
 * `src/`, a partir de la carpeta de este archivo.
 *
 * `unicorn/prefer-module` pide `import.meta.url` en su lugar, y aquí no vale: el paquete declara
 * `"type": "module"` pero jest transpila con `@swc/jest` a CommonJS —no hay `extensionsToTreatAsEsm`
 * en `jest.config.ts`—, así que `import.meta` no existe en tiempo de ejecución. `process.cwd()`
 * tampoco sirve: depende de desde dónde se invoque a jest, y estos tests tienen que encontrar las
 * hojas igual desde el paquete que desde la raíz del monorepo.
 */
// eslint-disable-next-line unicorn/prefer-module
const raiz = path.resolve(__dirname, '../..');

const leerHoja = (relativa: string): string =>
  readFileSync(path.join(raiz, relativa), 'utf8')
    // Fuera los comentarios de bloque y de línea: aquí sólo interesan las reglas.
    .replaceAll(/\/\*[\S\s]*?\*\//g, ' ')
    .replaceAll(/^\s*\/\/.*$/gm, ' ');

const hojaSplit = leerHoja('te/theme/signin-split.scss');
const hojaColumna = leerHoja('te/channel/TeSignInAside/index.module.scss');

/**
 * El bloque `{…}` que abre el selector dado, con sus llaves anidadas equilibradas.
 *
 * Hace falta contar llaves y no basta un `match`: las reglas del centrado viven dentro de
 * `@supports` y algunas también dentro de `@media`, así que un `[^}]*` se pararía en la primera
 * llave de cierre que encontrara, que no es la suya.
 */
const bloqueDe = (hoja: string, selector: string): string => {
  const inicio = hoja.indexOf(selector);
  expect(inicio).toBeGreaterThanOrEqual(0);

  const abre = hoja.indexOf('{', inicio);
  const { fin } = Array.from(hoja.slice(abre)).reduce(
    (estado, caracter, indice) => {
      if (estado.fin >= 0) {
        return estado;
      }

      const salto = { '{': 1, '}': -1 }[caracter] ?? 0;
      const profundidad = estado.profundidad + salto;

      return { profundidad, fin: profundidad === 0 && salto === -1 ? indice : -1 };
    },
    { profundidad: 0, fin: -1 }
  );

  expect(fin).toBeGreaterThan(0);

  return hoja.slice(abre + 1, abre + fin);
};

/** El cuerpo de la regla que fija el tamaño de la tarjeta cuando hay dos columnas. */
const reglaTarjeta = bloqueDe(hojaSplit, 'body.desktop .logto_main-content:has(.te_signin-aside),');

describe('F5 · la tarjeta, centrada en la ventana', () => {
  /*
   * La causa (a), la que reproduje en 1024×700 con user-agent móvil: `body.mobile .main` trae
   * `flex: 1; align-self: stretch` —«esta tarjeta ES la pantalla»— y con la columna encendida por
   * ancho eso deja la tarjeta pegada al borde izquierdo y estirada a lo alto de la ventana.
   */
  it('con dos columnas la tarjeta deja de estirarse y se centra, también con user-agent móvil', () => {
    expect(reglaTarjeta).toMatch(/flex:\s*none/);
    expect(reglaTarjeta).toMatch(/align-self:\s*center/);
  });

  it('y recupera su forma de tarjeta: alto mínimo, esquinas, fondo y sombra', () => {
    expect(reglaTarjeta).toMatch(/min-height:\s*540px/);
    expect(reglaTarjeta).toMatch(/border-radius:\s*16px/);
    expect(reglaTarjeta).toMatch(/background:\s*var\(--color-bg-float\)/);
    expect(reglaTarjeta).toMatch(/box-shadow:\s*var\(--color-shadow-2\)/);
  });

  /*
   * La columna es cuadrada o redondeada según lo sea la tarjeta, y desde F5 la tarjeta es
   * redondeada en las dos plataformas en cuanto hay dos columnas. El `border-radius: 0` que había
   * para `body.mobile` dejaría la columna asomando por las esquinas.
   */
  it('la columna redondea su lado izquierdo sin mirar el user-agent', () => {
    expect(hojaColumna).toMatch(/border-radius:\s*16px 0 0 16px/);
    expect(hojaColumna).not.toMatch(/body\.mobile[\S\s]{0,120}border-radius:\s*0/);
  });

  /*
   * `body.mobile .container` no tenía relleno porque la tarjeta ocupaba la pantalla. Ahora flota, y
   * sin esto tocaría los cuatro bordes de la ventana.
   */
  it('el lienzo deja aire alrededor de la tarjeta recién despegada, y respeta la zona segura', () => {
    const lienzo = bloqueDe(hojaSplit, 'body.mobile .logto_page-container:has(.te_signin-aside)');

    expect(lienzo).toMatch(/padding:\s*20px/);
    expect(lienzo).toMatch(/padding-bottom:\s*max\(20px,\s*env\(safe-area-inset-bottom\)\)/);
  });
});

describe('F5 · las dos columnas, sobre la misma línea', () => {
  /*
   * La causa (b): los dos rellenos flexibles de `FirstScreenLayout` son `flex: 3` arriba y
   * `flex: 5` abajo —el centro óptico de Logto, pensado para UNA columna—, así que el formulario
   * caía al 37,5 % del hueco sobrante y la columna del código al 50 %.
   *
   * Se igualan a `flex: 1`, y la caja que lleva la columna dentro deja de estirarse para que el
   * hueco sobrante sea de los rellenos y de nadie más. Se identifica por lo que contiene y no por
   * su posición: si `FirstScreenLayout` cambiara el número de rellenos, esto seguiría valiendo.
   */
  it('los rellenos de arriba y de abajo reparten a partes iguales', () => {
    const rellenos = bloqueDe(
      hojaSplit,
      'body.desktop .logto_main-content:has(.te_signin-aside) > div,'
    );

    expect(rellenos).toMatch(/flex:\s*1/);
  });

  it('la caja del contenido mide lo suyo y no se estira', () => {
    const contenido = bloqueDe(
      hojaSplit,
      'body.desktop .logto_main-content:has(.te_signin-aside) > div:has(> .te_signin-aside),'
    );

    expect(contenido).toMatch(/flex:\s*none/);
  });

  /*
   * En móvil vertical no hay columna que alinear, pero la tarjeta ocupa la pantalla y el
   * formulario se quedaba arriba con el 40 % de abajo vacío. El mismo `flex: none` lo arregla,
   * porque la tarjeta ya traía `justify-content: center` de serie — y por eso estas dos reglas
   * tienen que quedar FUERA de la media query de 820 px.
   */
  it('el centrado del contenido vale a cualquier ancho, no sólo con dos columnas', () => {
    const media = hojaSplit.indexOf('@media (min-width: 820px)');
    const igualaRellenos = hojaSplit.indexOf(
      'body.desktop .logto_main-content:has(.te_signin-aside) > div,'
    );

    expect(igualaRellenos).toBeGreaterThanOrEqual(0);
    expect(igualaRellenos).toBeLessThan(media);
  });

  /*
   * La causa (c). La columna va en posición absoluta y su caja contenedora es la caja de RELLENO de
   * la tarjeta, así que se centra sobre el centro real; el formulario vive en la caja de contenido.
   * Con 30 arriba y 26 abajo los dos centros se separaban 2 px. Los 56 px totales no cambian.
   */
  it('el relleno vertical de la tarjeta es simétrico: los dos centros coinciden', () => {
    const relleno = /padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px\s+(\d+)px/.exec(reglaTarjeta);

    expect(relleno).not.toBeNull();

    const [, arriba, derecha, abajo, izquierda] = relleno!;

    expect(arriba).toBe(abajo);
    // Y el hueco de la columna sigue siendo el de siempre: 340 de columna + 28 de aire.
    expect(izquierda).toBe('368');
    expect(derecha).toBe('28');
    // Los mismos 56 px de antes, repartidos igual: la tarjeta no cambia de alto.
    expect(Number(arriba) + Number(abajo)).toBe(56);
  });

  /*
   * La otra mitad del criterio vive en la columna, y es un `justify-content: center` que viene del
   * mixin sin argumentos. Si alguien le pasara `flex-start`, la columna subiría y el formulario se
   * quedaría en el centro: el mismo defecto, del revés.
   */
  it('la columna centra su contenido, y sólo cuando está encendida', () => {
    const encendida = bloqueDe(hojaColumna, '@media (min-width: 820px)');

    expect(encendida).toMatch(/@include _\.flex-column;/);
    expect(encendida).not.toMatch(/justify-content/);
  });
});

describe('F5 · el centrado no recorta por arriba', () => {
  /*
   * El encargo lo pide expresamente: centrar mal es peor que no centrar. Aquí el centrado se hace
   * repartiendo HUECO SOBRANTE con `flex`, que cuando no hay hueco reparte cero y deja crecer a la
   * tarjeta; `.container` la sigue con su `min-height: 100%` y el `.viewBox` de Logto desplaza.
   *
   * Lo que sí recortaría es fijarle una altura a la tarjeta, o centrarla con `position: absolute` y
   * `transform`, o con márgenes negativos. Nada de eso puede aparecer en esta hoja.
   */
  it('no se centra con altura fija, ni con posición absoluta, ni con márgenes negativos', () => {
    expect(hojaSplit).not.toMatch(/height:\s*(100vh|100%)/);
    expect(hojaSplit).not.toMatch(/position:\s*absolute/);
    expect(hojaSplit).not.toMatch(/transform:\s*translate/);
    expect(hojaSplit).not.toMatch(/margin[^:]*:\s*-/);
  });
});

describe('lo que el centrado NO se puede llevar por delante', () => {
  /*
   * Las tres cosas que el encargo marca como intocables. No son adorno: el `:has()` es lo que ata
   * el ancho de la tarjeta a la presencia de la columna —sin él existe el estado «tarjeta ancha con
   * la mitad izquierda vacía»—, y la media query de 820 px es el ÚNICO interruptor
   * escritorio/móvil de esta pantalla desde que se quitó el `usePlatform()`.
   */
  it('todo sigue dentro de `@supports selector(:has(*))`', () => {
    // Un solo bloque, y la hoja entera es ese bloque: ninguna regla se ha escapado fuera, que es
    // donde se aplicaría en un navegador sin `:has()` — el que no puede ensanchar la tarjeta.
    expect(hojaSplit.match(/@supports/g)).toHaveLength(1);
    expect(hojaSplit.trim()).toMatch(/^@supports selector\(:has\(\*\)\) {[\S\s]*}$/);
  });

  it('el ancho de la tarjeta sigue colgando de la presencia de la columna', () => {
    expect(reglaTarjeta).toMatch(/width:\s*860px/);
    expect(reglaTarjeta).toMatch(/max-width:\s*100%/);
    // El `:has()` está en el selector, no en un comentario.
    expect(hojaSplit).toMatch(/\.logto_main-content:has\(\.te_signin-aside\)/);
  });

  it('el interruptor sigue siendo una sola media query, y sigue siendo 820 px', () => {
    const medias = hojaSplit.match(/@media[^{]+/g) ?? [];

    expect(medias).toHaveLength(1);
    expect(medias[0]).toMatch(/@media \(min-width: 820px\)/);
  });

  it('la columna sigue midiendo 340 px y escondida por debajo del interruptor', () => {
    expect(bloqueDe(hojaColumna, '.aside {')).toMatch(/width:\s*340px/);
    expect(bloqueDe(hojaColumna, '.aside {')).toMatch(/display:\s*none/);
    expect(bloqueDe(hojaColumna, '.aside {')).toMatch(/overflow-y:\s*auto/);
  });
});
