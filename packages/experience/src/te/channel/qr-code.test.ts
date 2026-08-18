/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* Y se leen módulos por índice y se comparan bits: el test habla el idioma de lo que prueba. */
/* eslint-disable n/prefer-global/text-encoder, no-bitwise, @silverhand/fp/no-let, @silverhand/fp/no-mutation */

import { TextEncoder } from 'node:util';

import {
  bitsDeFormato,
  codificar,
  correccion,
  estructura,
  palabrasDeCorreccion,
  palabrasDeDatos,
} from './qr-code';

// Jsdom no trae `TextEncoder`; el navegador sí. El codificador trabaja sobre los bytes UTF-8 del
// enlace, así que sin esto no hay nada que codificar.
// eslint-disable-next-line @silverhand/fp/no-mutating-methods
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });

/**
 * Palabras totales de cada versión según ISO/IEC 18004, tabla 1. Es un dato externo al código:
 * si la tabla de bloques tiene una errata, la suma no cuadra y este test lo dice.
 */
const TOTAL_POR_VERSION = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

describe('el codificador de QR', () => {
  it('las tablas de bloques cuadran con el total de palabras de la norma', () => {
    for (const [indice, total] of TOTAL_POR_VERSION.entries()) {
      const version = indice + 1;

      expect(palabrasDeDatos(version) + palabrasDeCorreccion(version)).toBe(total);
    }
  });

  it('la corrección de Reed-Solomon devuelve tantas palabras como se le piden', () => {
    const datos = Uint8Array.from([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]);

    expect(correccion(datos, 13)).toHaveLength(13);
  });

  it('los bits de formato son 15 y difieren entre máscaras', () => {
    const todos = Array.from({ length: 8 }, (_, patron) => bitsDeFormato(patron));

    for (const bits of todos) {
      expect(bits).toBeLessThan(1 << 15);
    }

    expect(new Set(todos).size).toBe(8);
  });

  describe('la estructura del símbolo', () => {
    it('tiene el lado que dice la norma: 4·versión + 17', () => {
      expect(estructura(1).tamano).toBe(21);
      expect(estructura(10).tamano).toBe(57);
    });

    it('deja intacta la línea de sincronismo, que es con lo que el lector mide el módulo', () => {
      const { tamano, modulos } = estructura(2);

      // Fila 6, entre los patrones de búsqueda: alterna oscuro y claro.
      for (let columna = 8; columna < tamano - 8; columna += 1) {
        expect(modulos[6 * tamano + columna]).toBe(columna % 2 === 0 ? 1 : 0);
      }
    });

    it('reserva las zonas de formato sin pisar el sincronismo', () => {
      // (8,6) y (6,8) son sincronismo, no formato. Ponerlos a cero rompería las dos líneas con
      // las que el lector mide el tamaño del módulo: el símbolo saldría bonito y no lo leería
      // nadie.
      const { tamano, modulos } = estructura(2);

      expect(modulos[8 * tamano + 6]).toBe(1);
      expect(modulos[6 * tamano + 8]).toBe(1);
    });
  });

  describe('codificar', () => {
    it('elige la versión más pequeña en la que cabe el contenido', () => {
      const corto = codificar('te://requests/1');
      const largo = codificar(`te://requests/${'a'.repeat(120)}`);

      expect(corto.version).toBeLessThan(largo.version);
    });

    it('un enlace típico del canal cabe de sobra', () => {
      const simbolo = codificar('te://requests/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');

      expect(simbolo.version).toBeLessThanOrEqual(10);
      expect(simbolo.modulos).toHaveLength(simbolo.tamano * simbolo.tamano);
      expect(simbolo.mascara).toBeGreaterThanOrEqual(0);
      expect(simbolo.mascara).toBeLessThan(8);
    });

    it('es determinista: el mismo texto da el mismo símbolo', () => {
      const uno = codificar('te://requests/abc');
      const dos = codificar('te://requests/abc');

      expect(uno.mascara).toBe(dos.mascara);
      expect([...uno.modulos]).toEqual([...dos.modulos]);
    });

    it('el módulo oscuro obligatorio queda puesto en el símbolo final', () => {
      // Se pinta al escribir el formato, no en la estructura: allí lo pisa la reserva de la zona
      // de formato vertical. Comprobarlo sobre la estructura habría dado un falso negativo.
      const simbolo = codificar('te://requests/abc');

      expect(simbolo.modulos[(4 * simbolo.version + 9) * simbolo.tamano + 8]).toBe(1);
    });

    it('los patrones de búsqueda están en las tres esquinas del símbolo pintado', () => {
      const { tamano, modulos } = codificar('te://requests/abc');
      const centro = (fila: number, columna: number) => modulos[fila * tamano + columna];

      // Centro de cada ojo: 3×3 oscuro.
      expect(centro(3, 3)).toBe(1);
      expect(centro(3, tamano - 4)).toBe(1);
      expect(centro(tamano - 4, 3)).toBe(1);
      // Y el anillo claro que lo rodea.
      expect(centro(1, 5)).toBe(0);
    });

    it('revienta antes que pintar algo ilegible si el contenido no cabe', () => {
      expect(() => codificar('x'.repeat(400))).toThrow(RangeError);
    });
  });
});

/* eslint-enable */
