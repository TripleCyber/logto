/*
 * Núcleo aritmético sobre GF(256), portado literalmente de
 * `tripleenable-api/src/navegador/qr.js`.
 *
 * Se conserva la forma imperativa y la nomenclatura de la norma —`a`, `b`, `n`, `| 0`, máscaras
 * de bits— a propósito. Reescribirlo en el estilo del resto del paquete lo haría más lento y,
 * sobre todo, imposible de comparar línea a línea con ISO/IEC 18004 y con el original del que
 * sale. Es exactamente el tipo de código donde una reescritura «equivalente» mete una errata que
 * sólo aparece en la versión 7 del símbolo y que nadie encuentra hasta que un usuario no puede
 * escanear.
 *
 * El silencio es de este archivo y de ninguno más: cualquier otro fichero bajo `te/` cumple las
 * reglas del paquete.
 */
/* eslint-disable @silverhand/fp/no-mutation, @silverhand/fp/no-let, @silverhand/fp/no-mutating-methods, no-bitwise, complexity, max-lines, id-length, capitalized-comments, unicorn/numeric-separators-style, unicorn/no-for-loop, unicorn/prefer-math-trunc, unicorn/prevent-abbreviations, @typescript-eslint/array-type */

/**
 * Codificador de códigos QR: modo byte, nivel de corrección **Q**, versiones 1 a 10. Sin
 * dependencias.
 *
 * ## Por qué está aquí y no se pide el PNG al servidor
 *
 * La rama previa resolvía el QR pidiéndole al servidor una imagen en `data:` URL. Eso obliga a
 * abrir `img-src data:` en la política de contenido de la experiencia, y la página de te-api
 * dibujaba en `<canvas>` **precisamente** para no abrir esa rendija. Portar el codificador
 * mantiene la propiedad; pedir el PNG la habría perdido en una línea que nadie habría revisado.
 *
 * Son doscientas líneas de aritmética sobre GF(256) sin ninguna entrada del usuario: lo que
 * entra es un enlace `te://…` que construye el servidor.
 *
 * ## Por qué nivel Q y no M
 *
 * Q corrige el 25 % del símbolo (OP-2). Con M, una pegatina superpuesta parcial —el ataque
 * físico barato contra un QR impreso o proyectado— puede producir una lectura **alterada**: el
 * lector reconstruye un contenido distinto y válido. Con el 25 % de redundancia, lo que produce
 * antes es un fallo de lectura, que es el fallo que se quiere: la cartera no resuelve nada y la
 * persona vuelve a intentarlo.
 *
 * ## Referencias
 *
 * ISO/IEC 18004. Las tablas de bloques y de patrones de alineación son las del estándar; los
 * polinomios BCH del formato (0x537) y de la versión (0x1F25) se calculan aquí en vez de
 * tabularse, porque una tabla copiada a mano es una tabla con una errata.
 */

/** Nivel Q en el campo de formato del símbolo. */
const NIVEL_Q = 0b11;

/**
 * Por versión: [correcciones por bloque, bloques del grupo 1, datos por bloque del grupo 1,
 * bloques del grupo 2, datos por bloque del grupo 2].
 *
 * Se comprueba sola: `bloques1·datos1 + bloques2·datos2` tiene que ser el número de palabras de
 * datos de la versión, y `(bloques1+bloques2)·ec` el de corrección. Hay un test que hace
 * exactamente esa suma para las diez.
 */
const BLOQUES = [
  /* 1  */ [13, 1, 13, 0, 0],
  /* 2  */ [22, 1, 22, 0, 0],
  /* 3  */ [18, 2, 17, 0, 0],
  /* 4  */ [26, 2, 24, 0, 0],
  /* 5  */ [18, 2, 15, 2, 16],
  /* 6  */ [24, 4, 19, 0, 0],
  /* 7  */ [18, 2, 14, 4, 15],
  /* 8  */ [22, 4, 18, 2, 19],
  /* 9  */ [20, 4, 16, 4, 17],
  /* 10 */ [24, 6, 19, 2, 20],
] as const;

/** Centros de los patrones de alineación, por versión. */
const ALINEACION: readonly (readonly number[])[] = [
  /* 1  */ [],
  /* 2  */ [6, 18],
  /* 3  */ [6, 22],
  /* 4  */ [6, 26],
  /* 5  */ [6, 30],
  /* 6  */ [6, 34],
  /* 7  */ [6, 22, 38],
  /* 8  */ [6, 24, 42],
  /* 9  */ [6, 26, 46],
  /* 10 */ [6, 28, 50],
];

// ── GF(256), polinomio primitivo 0x11D ──────────────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if ((x & 0x100) !== 0) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    EXP[i] = EXP[i - 255] ?? 0;
  }
}

const multiplicar = (a: number, b: number): number => {
  if (a === 0 || b === 0) {
    return 0;
  }

  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
};

/** Polinomio generador de grado `n`. */
const generador = (n: number): Uint8Array => {
  let poli = new Uint8Array([1]);

  for (let i = 0; i < n; i += 1) {
    const siguiente = new Uint8Array(poli.length + 1);
    for (let j = 0; j < poli.length; j += 1) {
      siguiente[j] = (siguiente[j] ?? 0) ^ (poli[j] ?? 0);
      siguiente[j + 1] = (siguiente[j + 1] ?? 0) ^ multiplicar(poli[j] ?? 0, EXP[i] ?? 0);
    }
    poli = siguiente;
  }

  return poli;
};

/** Palabras de corrección de un bloque (resto de la división por el generador). */
export const correccion = (datos: Uint8Array, n: number): Uint8Array => {
  const gen = generador(n);
  const resto = new Uint8Array(n);

  for (const byte of datos) {
    const factor = byte ^ (resto[0] ?? 0);
    resto.copyWithin(0, 1);
    resto[n - 1] = 0;
    for (let i = 0; i < n; i += 1) {
      resto[i] = (resto[i] ?? 0) ^ multiplicar(gen[i + 1] ?? 0, factor);
    }
  }

  return resto;
};

// ── Codificación ────────────────────────────────────────────────────────

/** Palabras de datos de la versión, en nivel Q. */
export const palabrasDeDatos = (version: number): number => {
  const [, b1, d1, b2, d2] = BLOQUES[version - 1] ?? [0, 0, 0, 0, 0];

  return b1 * d1 + b2 * d2;
};

/** Palabras de corrección de la versión, en nivel Q. */
export const palabrasDeCorreccion = (version: number): number => {
  const [ec, b1, , b2] = BLOQUES[version - 1] ?? [0, 0, 0, 0, 0];

  return (b1 + b2) * ec;
};

/**
 * La versión más pequeña en la que caben `longitud` bytes en modo byte.
 *
 * Revienta si no cabe en la versión 10. El enlace lo construye el servidor y mide poco más de
 * ochenta caracteres; si alguien alarga el esquema hasta aquí, es mejor que falle en el primer
 * despliegue que que la pantalla se quede en blanco.
 */
const versionParaLongitud = (longitud: number): number => {
  for (let version = 1; version <= BLOQUES.length; version += 1) {
    // 4 bits de modo + 8 o 16 de cuenta.
    const cabecera = version < 10 ? 12 : 20;
    if (palabrasDeDatos(version) * 8 >= cabecera + longitud * 8) {
      return version;
    }
  }

  throw new RangeError('el contenido no cabe en un QR de versión 10 con nivel Q');
};

/** Flujo de bits de datos, ya con relleno, listo para partir en bloques. */
const palabras = (bytes: Uint8Array, version: number): Uint8Array => {
  const bits: number[] = [];
  const empujar = (valor: number, cuantos: number) => {
    for (let i = cuantos - 1; i >= 0; i -= 1) {
      bits.push((valor >> i) & 1);
    }
  };

  empujar(0b0100, 4); // modo byte
  empujar(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) {
    empujar(byte, 8);
  }

  const capacidad = palabrasDeDatos(version) * 8;
  // Terminador: hasta cuatro ceros, o menos si no queda sitio.
  const terminador = capacidad - bits.length;
  empujar(0, terminador < 4 ? terminador : 4);
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const salida = new Uint8Array(palabrasDeDatos(version));
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) {
      byte = (byte << 1) | (bits[i + j] ?? 0);
    }
    salida[i / 8] = byte;
  }

  // Relleno alterno del estándar.
  for (let i = bits.length / 8, alterno = true; i < salida.length; i += 1, alterno = !alterno) {
    salida[i] = alterno ? 0xec : 0x11;
  }

  return salida;
};

/** Parte en bloques, calcula la corrección de cada uno y los entrelaza. */
const entrelazar = (datos: Uint8Array, version: number): Uint8Array => {
  const [ec, b1, d1, b2, d2] = BLOQUES[version - 1] ?? [0, 0, 0, 0, 0];
  const bloques: Uint8Array[] = [];
  const correcciones: Uint8Array[] = [];

  let desde = 0;
  for (let i = 0; i < b1 + b2; i += 1) {
    const cuantos = i < b1 ? d1 : d2;
    const bloque = datos.subarray(desde, desde + cuantos);
    desde += cuantos;
    bloques.push(bloque);
    correcciones.push(correccion(bloque, ec));
  }

  const salida: number[] = [];
  const maximo = d1 > d2 ? d1 : d2;
  for (let i = 0; i < maximo; i += 1) {
    for (const bloque of bloques) {
      if (i < bloque.length) {
        salida.push(bloque[i] ?? 0);
      }
    }
  }
  for (let i = 0; i < ec; i += 1) {
    for (const bloque of correcciones) {
      salida.push(bloque[i] ?? 0);
    }
  }

  return Uint8Array.from(salida);
};

// ── La matriz ───────────────────────────────────────────────────────────

type Lienzo = { tamano: number; modulos: Uint8Array; funcion: Uint8Array };

const ponerFuncion = (lienzo: Lienzo, fila: number, columna: number, valor: number) => {
  if (fila < 0 || columna < 0 || fila >= lienzo.tamano || columna >= lienzo.tamano) {
    return;
  }

  lienzo.modulos[fila * lienzo.tamano + columna] = valor;
  lienzo.funcion[fila * lienzo.tamano + columna] = 1;
};

const buscador = (lienzo: Lienzo, fila: number, columna: number) => {
  for (let df = -1; df <= 7; df += 1) {
    for (let dc = -1; dc <= 7; dc += 1) {
      const anillo =
        (df >= 0 && df <= 6 && (dc === 0 || dc === 6)) ||
        (dc >= 0 && dc <= 6 && (df === 0 || df === 6));
      const centro = df >= 2 && df <= 4 && dc >= 2 && dc <= 4;
      ponerFuncion(lienzo, fila + df, columna + dc, anillo || centro ? 1 : 0);
    }
  }
};

/**
 * Los patrones fijos del símbolo y la marca de qué módulos son de función.
 *
 * Se exporta para que la suite pueda **leer** un símbolo sin volver a escribir la lógica de qué
 * posiciones llevan datos: un test que reconstruyera ese mapa por su cuenta comprobaría su propia
 * copia, no ésta.
 */
export const estructura = (version: number): Lienzo => {
  const tamano = version * 4 + 17;
  const lienzo: Lienzo = {
    tamano,
    modulos: new Uint8Array(tamano * tamano),
    funcion: new Uint8Array(tamano * tamano),
  };

  buscador(lienzo, 0, 0);
  buscador(lienzo, 0, tamano - 7);
  buscador(lienzo, tamano - 7, 0);

  // Sincronismo.
  for (let i = 8; i < tamano - 8; i += 1) {
    const valor = i % 2 === 0 ? 1 : 0;
    ponerFuncion(lienzo, 6, i, valor);
    ponerFuncion(lienzo, i, 6, valor);
  }

  // Alineación, saltando los que pisarían un patrón de búsqueda.
  const centros = ALINEACION[version - 1] ?? [];
  for (const fila of centros) {
    for (const columna of centros) {
      const esquina =
        (fila <= 8 && columna <= 8) ||
        (fila <= 8 && columna >= tamano - 9) ||
        (fila >= tamano - 9 && columna <= 8);
      if (esquina) {
        continue;
      }
      for (let df = -2; df <= 2; df += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const distancia = Math.max(Math.abs(df), Math.abs(dc));
          ponerFuncion(lienzo, fila + df, columna + dc, distancia === 1 ? 0 : 1);
        }
      }
    }
  }

  // Módulo oscuro y reserva de las zonas de formato.
  //
  // El 6 se salta en las dos: (8,6) y (6,8) son sincronismo, no formato. Escribirlos aquí como
  // reserva del formato los pondría a cero y rompería las dos líneas que el lector usa para medir
  // el tamaño del módulo — el símbolo saldría bonito y no lo leería nadie.
  ponerFuncion(lienzo, 4 * version + 9, 8, 1);
  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) {
      continue;
    }
    ponerFuncion(lienzo, 8, i, 0);
    ponerFuncion(lienzo, i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    ponerFuncion(lienzo, 8, tamano - 1 - i, 0);
    ponerFuncion(lienzo, tamano - 1 - i, 8, 0);
  }

  // Zonas de la versión (sólo de la 7 en adelante).
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = tamano - 11 + (i % 3);
      const b = (i / 3) | 0;
      ponerFuncion(lienzo, b, a, 0);
      ponerFuncion(lienzo, a, b, 0);
    }
  }

  return lienzo;
};

/** Coloca las palabras en zigzag, saltando los módulos de función. */
const colocar = (lienzo: Lienzo, palabrasFinales: Uint8Array) => {
  const { tamano } = lienzo;
  let bit = 0;
  let subiendo = true;

  for (let derecha = tamano - 1; derecha > 0; derecha -= 2) {
    if (derecha === 6) {
      derecha = 5; // la columna 6 es sincronismo
    }
    for (let paso = 0; paso < tamano; paso += 1) {
      const fila = subiendo ? tamano - 1 - paso : paso;
      for (const columna of [derecha, derecha - 1]) {
        const indice = fila * tamano + columna;
        if (lienzo.funcion[indice] === 1) {
          continue;
        }
        const palabra = palabrasFinales[bit >> 3] ?? 0;
        lienzo.modulos[indice] = (palabra >> (7 - (bit & 7))) & 1;
        bit += 1;
      }
    }
    subiendo = !subiendo;
  }
};

/** Las ocho máscaras del estándar. */
const mascara = (patron: number, fila: number, columna: number): boolean => {
  switch (patron) {
    case 0: {
      return (fila + columna) % 2 === 0;
    }
    case 1: {
      return fila % 2 === 0;
    }
    case 2: {
      return columna % 3 === 0;
    }
    case 3: {
      return (fila + columna) % 3 === 0;
    }
    case 4: {
      return (((fila / 2) | 0) + ((columna / 3) | 0)) % 2 === 0;
    }
    case 5: {
      return ((fila * columna) % 2) + ((fila * columna) % 3) === 0;
    }
    case 6: {
      return (((fila * columna) % 2) + ((fila * columna) % 3)) % 2 === 0;
    }
    default: {
      return (((fila + columna) % 2) + ((fila * columna) % 3)) % 2 === 0;
    }
  }
};

/** Los 15 bits de formato: nivel y máscara, con su BCH y el XOR del estándar. */
export const bitsDeFormato = (patron: number): number => {
  const datos = (NIVEL_Q << 3) | patron;
  let resto = datos;

  for (let i = 0; i < 10; i += 1) {
    resto = (resto << 1) ^ ((resto >> 9) * 0x537);
  }

  return ((datos << 10) | (resto & 0x3ff)) ^ 0x5412;
};

const escribirFormato = (lienzo: Lienzo, patron: number) => {
  const bits = bitsDeFormato(patron);
  const { tamano } = lienzo;
  const bit = (i: number) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i += 1) {
    ponerFuncion(lienzo, i, 8, bit(i));
  }
  ponerFuncion(lienzo, 7, 8, bit(6));
  ponerFuncion(lienzo, 8, 8, bit(7));
  ponerFuncion(lienzo, 8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) {
    ponerFuncion(lienzo, 8, 14 - i, bit(i));
  }

  for (let i = 0; i < 8; i += 1) {
    ponerFuncion(lienzo, tamano - 1 - i, 8, bit(i));
  }
  for (let i = 8; i < 15; i += 1) {
    ponerFuncion(lienzo, 8, tamano - 15 + i, bit(i));
  }
  ponerFuncion(lienzo, tamano - 8, 8, 1);
};

const escribirVersion = (lienzo: Lienzo, version: number) => {
  if (version < 7) {
    return;
  }

  let resto = version;
  for (let i = 0; i < 12; i += 1) {
    resto = (resto << 1) ^ ((resto >> 11) * 0x1f25);
  }
  const bits = (version << 12) | (resto & 0xfff);

  for (let i = 0; i < 18; i += 1) {
    const valor = (bits >> i) & 1;
    const a = lienzo.tamano - 11 + (i % 3);
    const b = (i / 3) | 0;
    ponerFuncion(lienzo, b, a, valor);
    ponerFuncion(lienzo, a, b, valor);
  }
};

/**
 * Penalización del estándar. Se evalúan las ocho máscaras y gana la más baja: es lo que evita que
 * un símbolo salga con bandas o con algo que se parezca a un patrón de búsqueda, que es lo que
 * hace fallar a los lectores baratos.
 */
const penalizacion = (lienzo: Lienzo): number => {
  const { tamano, modulos } = lienzo;
  let total = 0;

  const porLineas = (leer: (i: number, j: number) => number) => {
    for (let i = 0; i < tamano; i += 1) {
      let seguidos = 1;
      let anterior = leer(i, 0);
      const historial: number[] = [];

      for (let j = 1; j < tamano; j += 1) {
        const actual = leer(i, j);
        if (actual === anterior) {
          seguidos += 1;
        } else {
          if (seguidos >= 5) {
            total += 3 + (seguidos - 5);
          }
          historial.push(seguidos);
          seguidos = 1;
          anterior = actual;
        }
      }
      if (seguidos >= 5) {
        total += 3 + (seguidos - 5);
      }
      historial.push(seguidos);

      // Regla 3: el patrón 1:1:3:1:1 con cuatro módulos claros a un lado, que es lo que un lector
      // confunde con un patrón de búsqueda.
      const primero = leer(i, 0);
      for (let k = 0; k + 4 < historial.length; k += 1) {
        const oscuroEnK = (k % 2 === 0) === (primero === 1);
        if (!oscuroEnK) {
          continue;
        }
        const a = historial[k] ?? 0;
        const b = historial[k + 1] ?? 0;
        const c = historial[k + 2] ?? 0;
        const d = historial[k + 3] ?? 0;
        const e = historial[k + 4] ?? 0;
        if (a === 1 && b === 1 && c === 3 && d === 1 && e === 1) {
          const antes = k >= 1 ? (historial[k - 1] ?? 0) : 0;
          const despues = k + 5 < historial.length ? (historial[k + 5] ?? 0) : 0;
          if (antes >= 4 || despues >= 4) {
            total += 40;
          }
        }
      }
    }
  };

  porLineas((i, j) => modulos[i * tamano + j] ?? 0);
  porLineas((i, j) => modulos[j * tamano + i] ?? 0);

  // Regla 2: bloques de 2×2 del mismo color.
  for (let i = 0; i < tamano - 1; i += 1) {
    for (let j = 0; j < tamano - 1; j += 1) {
      const a = modulos[i * tamano + j] ?? 0;
      if (
        a === (modulos[i * tamano + j + 1] ?? 0) &&
        a === (modulos[(i + 1) * tamano + j] ?? 0) &&
        a === (modulos[(i + 1) * tamano + j + 1] ?? 0)
      ) {
        total += 3;
      }
    }
  }

  // Regla 4: desequilibrio entre claros y oscuros.
  let oscuros = 0;
  for (const modulo of modulos) {
    oscuros += modulo;
  }
  const proporcion = (oscuros * 100) / (tamano * tamano);
  const desvio = proporcion > 50 ? proporcion - 50 : 50 - proporcion;
  total += ((desvio / 5) | 0) * 10;

  return total;
};

export type Simbolo = {
  readonly tamano: number;
  readonly modulos: Uint8Array;
  readonly version: number;
  readonly mascara: number;
};

/** Codifica un texto en un símbolo QR. */
export const codificar = (texto: string): Simbolo => {
  const bytes = new TextEncoder().encode(texto);
  const version = versionParaLongitud(bytes.length);
  const finales = entrelazar(palabras(bytes, version), version);

  const base = estructura(version);
  colocar(base, finales);
  escribirVersion(base, version);

  let mejor: Simbolo | undefined;
  let mejorPena = Number.POSITIVE_INFINITY;

  for (let patron = 0; patron < 8; patron += 1) {
    const candidato: Lienzo = {
      tamano: base.tamano,
      modulos: Uint8Array.from(base.modulos),
      funcion: base.funcion,
    };

    for (let fila = 0; fila < candidato.tamano; fila += 1) {
      for (let columna = 0; columna < candidato.tamano; columna += 1) {
        const indice = fila * candidato.tamano + columna;
        if (candidato.funcion[indice] === 1) {
          continue;
        }
        if (mascara(patron, fila, columna)) {
          candidato.modulos[indice] = (candidato.modulos[indice] ?? 0) ^ 1;
        }
      }
    }
    escribirFormato(candidato, patron);

    const pena = penalizacion(candidato);
    if (pena < mejorPena) {
      mejorPena = pena;
      mejor = { tamano: candidato.tamano, modulos: candidato.modulos, version, mascara: patron };
    }
  }

  if (!mejor) {
    throw new Error('no se pudo elegir máscara');
  }

  return mejor;
};

/**
 * Pinta un símbolo en un contexto 2D, con su zona de silencio.
 *
 * Vive aquí y no en el componente por dos razones. La primera es de responsabilidad: el
 * componente hace React y este módulo hace píxeles. La segunda es concreta y menos obvia — el
 * bucle de dibujo es el mismo tipo de código imperativo que el resto del archivo, y tenerlo aquí
 * evita repartir silencios de reglas por componentes que sí deben cumplirlas.
 *
 * `porModulo` tiene que ser un entero: si cada módulo no cae en un número entero de píxeles del
 * dispositivo, el navegador reparte el sobrante y unos salen un píxel más anchos que otros. El
 * símbolo se ve bien y los lectores baratos fallan.
 *
 * Negro sobre blanco, siempre, también en tema oscuro. Un QR invertido lo leen algunos lectores
 * y otros no, y el que falla es siempre el de quien tiene prisa: el contraste del símbolo no es
 * una decisión de estilo.
 */
export const dibujar = (
  contexto: CanvasRenderingContext2D,
  simbolo: Simbolo,
  porModulo: number,
  silencio: number
) => {
  const lado = (simbolo.tamano + silencio * 2) * porModulo;

  contexto.fillStyle = '#fff';
  contexto.fillRect(0, 0, lado, lado);
  contexto.fillStyle = '#000';

  for (let fila = 0; fila < simbolo.tamano; fila += 1) {
    for (let columna = 0; columna < simbolo.tamano; columna += 1) {
      if (simbolo.modulos[fila * simbolo.tamano + columna] === 1) {
        contexto.fillRect(
          (columna + silencio) * porModulo,
          (fila + silencio) * porModulo,
          porModulo,
          porModulo
        );
      }
    }
  }
};

/* eslint-enable */
