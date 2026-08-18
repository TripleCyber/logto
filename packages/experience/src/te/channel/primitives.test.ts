/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan las de Node —la misma
 * familia de implementaciones— y por eso se importan de `node:util` en vez de usar el global que
 * la regla pide: aquí el global no existe hasta que estas líneas lo crean.
 */
/* eslint-disable n/prefer-global/text-encoder, n/prefer-global/text-decoder */

import { createHash, webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

import { crearReloj, desfase, fraccion, restanteMs, segundos } from './clock';
import { sha256, toBase64url, toBytes } from './encoding';
import { comoTexto, numeroDeEmparejamiento } from './pairing';
import { crearLigadura } from './verifier';

/*
 * Jsdom no trae `TextEncoder` ni `crypto.subtle`; el navegador sí. Se usan los de Node, que son
 * la misma familia de implementaciones, y eso es justo lo que permite comparar byte a byte con
 * lo que calcula el servidor — de lo que dependen las dos cerraduras del canal.
 */
/* eslint-disable-next-line @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
/* eslint-disable-next-line @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, writable: true });
/* eslint-disable-next-line @silverhand/fp/no-mutating-methods */
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, writable: true });

describe('codificación', () => {
  it('base64url coincide con lo que produce Node, que es lo que hace el servidor', () => {
    for (const longitud of [0, 1, 2, 3, 4, 31, 32, 33, 64]) {
      const bytes = Uint8Array.from({ length: longitud }, (_, index) => (index * 37) % 256);

      expect(toBase64url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });

  it('no deja relleno: un `=` colado es una cerradura buena que el servidor rechaza', () => {
    expect(toBase64url(Uint8Array.from([1]))).not.toContain('=');
    expect(toBase64url(Uint8Array.from([1, 2]))).not.toContain('=');
  });

  it('hashea los BYTES de la cadena, no la cadena: es lo que hace `Buffer.from(v, "utf8")`', async () => {
    const valor = 'año-ñ-€';
    const propio = await sha256(toBytes(valor));

    expect(Buffer.from(propio).toString('hex')).toBe(
      createHash('sha256').update(valor, 'utf8').digest('hex')
    );
  });
});

describe('la ligadura del canal', () => {
  it('declara exactamente `base64url(sha256(verifier))`, que es lo que el servidor recalcula', async () => {
    const { verifier, channelHash, channelHashBytes } = await crearLigadura();

    expect(channelHash).toBe(createHash('sha256').update(verifier, 'utf8').digest('base64url'));
    expect(toBase64url(channelHashBytes)).toBe(channelHash);
  });

  it('el verifier es distinto en cada pestaña', async () => {
    const uno = await crearLigadura();
    const dos = await crearLigadura();

    expect(uno.verifier).not.toBe(dos.verifier);
  });
});

describe('el número de emparejamiento (RL-1)', () => {
  const hash = Uint8Array.from({ length: 32 }, (_, index) => index);

  it('cae siempre entre 0 y 9999 y se lee con cuatro cifras', async () => {
    const numero = await numeroDeEmparejamiento('sesion-1', hash);

    expect(numero).toBeGreaterThanOrEqual(0);
    expect(numero).toBeLessThan(10_000);
    expect(comoTexto(numero)).toHaveLength(4);
  });

  it('rellena con ceros: 42 y 0042 tienen que ser el mismo texto en las dos pantallas', () => {
    expect(comoTexto(42)).toBe('0042');
    expect(comoTexto(0)).toBe('0000');
  });

  it('depende de la sesión: dos sesiones distintas no comparten número', async () => {
    const uno = await numeroDeEmparejamiento('sesion-1', hash);
    const dos = await numeroDeEmparejamiento('sesion-2', hash);

    expect(uno).not.toBe(dos);
  });

  it('depende del verifier: el mismo identificador con otra ligadura da otro número', async () => {
    const otro = Uint8Array.from({ length: 32 }, () => 7);

    expect(await numeroDeEmparejamiento('sesion-1', hash)).not.toBe(
      await numeroDeEmparejamiento('sesion-1', otro)
    );
  });

  it('es estable: la pantalla no puede enseñar dos números para el mismo canal', async () => {
    expect(await numeroDeEmparejamiento('sesion-1', hash)).toBe(
      await numeroDeEmparejamiento('sesion-1', hash)
    );
  });
});

describe('el reloj de la pantalla', () => {
  it('sin cabecera `Date` no corrige nada: un desfase inventado es peor que ninguno', () => {
    expect(desfase(undefined, 1000)).toBe(0);
    expect(desfase('', 1000)).toBe(0);
    expect(desfase('no es una fecha', 1000)).toBe(0);
  });

  it('mide el desfase con la hora del servidor', () => {
    const servidor = Date.parse('2026-08-15T10:00:00.000Z');

    expect(desfase('Sat, 15 Aug 2026 10:00:00 GMT', servidor - 40_000)).toBe(40_000);
  });

  it('un portátil adelantado deja de pintar «caducado» sobre un código vivo', () => {
    const expira = '2026-08-15T10:00:30.000Z';
    const localAdelantado = Date.parse('2026-08-15T10:00:40.000Z');
    const correccion = desfase('Sat, 15 Aug 2026 10:00:00 GMT', localAdelantado);

    // Sin corregir, el código parecería caducado hace diez segundos y la persona volvería a
    // empezar una y otra vez sin que hubiera nada roto.
    expect(restanteMs(expira, localAdelantado)).toBe(0);
    // Corrigiendo, quedan los treinta segundos que dijo el servidor.
    expect(restanteMs(expira, localAdelantado + correccion)).toBe(30_000);
  });

  it('el reloj corregido devuelve milisegundos en la escala del servidor', () => {
    const antes = Date.now();
    const reloj = crearReloj(-40_000);

    expect(reloj.ahora()).toBeLessThanOrEqual(antes - 40_000 + 50);
    expect(reloj.ahora()).toBeGreaterThanOrEqual(antes - 40_000);
  });

  it('nunca devuelve tiempo negativo', () => {
    expect(restanteMs('2026-08-15T10:00:00.000Z', Date.parse('2026-08-15T11:00:00.000Z'))).toBe(0);
    expect(restanteMs('mañana', 0)).toBe(0);
  });

  it('redondea los segundos hacia arriba, para no decir «0 s» sobre un código que sirve', () => {
    expect(segundos(1)).toBe(1);
    expect(segundos(1001)).toBe(2);
    expect(segundos(2000)).toBe(2);
  });

  it('la barra sólo puede encogerse, y se acota entre 0 y 1', () => {
    expect(fraccion(30_000, 30_000)).toBe(1);
    expect(fraccion(15_000, 30_000)).toBe(0.5);
    expect(fraccion(-1, 30_000)).toBe(0);
    expect(fraccion(60_000, 30_000)).toBe(1);
    expect(fraccion(10, 0)).toBe(0);
  });
});

/* eslint-enable */
