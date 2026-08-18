import { createHash } from 'node:crypto';

import {
  cabeceraFirma,
  cabeceraKeyId,
  cabeceraMarcaTiempo,
  cabeceraNonce,
  cadenaCanonica,
  construirCabecerasFirma,
  firmar,
  igualesEnTiempoConstante,
} from './hmac.js';

const clave = { kid: '2026-08', secreto: Buffer.alloc(32, 7) };

describe('cadena canónica', () => {
  it('lleva la versión, el método en mayúsculas y la ruta completa', () => {
    const canonica = cadenaCanonica({
      metodo: 'post',
      ruta: '/v1/s2s/qr/sessions',
      marcaTiempo: 1_700_000_000_000,
      nonce: 'nonce',
      cuerpo: '{}',
    });

    expect(canonica.split('\n')).toEqual([
      'TE1',
      'POST',
      '/v1/s2s/qr/sessions',
      '1700000000000',
      'nonce',
      createHash('sha256').update('{}', 'utf8').digest('base64url'),
    ]);
  });

  it('firma el cuerpo vacío como sha256("") en vez de omitir el campo', () => {
    const canonica = cadenaCanonica({
      metodo: 'GET',
      ruta: '/v1/s2s/channels',
      marcaTiempo: 1,
      nonce: 'n',
      cuerpo: '',
    });

    expect(canonica.endsWith(createHash('sha256').update('', 'utf8').digest('base64url'))).toBe(
      true
    );
  });

  it('distingue dos rutas que sólo difieren en el query string', () => {
    const comun = { metodo: 'POST', marcaTiempo: 1, nonce: 'n', cuerpo: '' };

    expect(cadenaCanonica({ ...comun, ruta: '/a' })).not.toEqual(
      cadenaCanonica({ ...comun, ruta: '/a?b=1' })
    );
  });

  it('cambia la firma si cambia el cuerpo, la ruta o la marca de tiempo', () => {
    const base = { metodo: 'POST', ruta: '/a', marcaTiempo: 1, nonce: 'n', cuerpo: '{"a":1}' };
    const referencia = firmar(clave.secreto, cadenaCanonica(base));

    for (const variante of [
      { ...base, cuerpo: '{"a":2}' },
      { ...base, ruta: '/b' },
      { ...base, marcaTiempo: 2 },
      { ...base, nonce: 'm' },
    ]) {
      expect(firmar(clave.secreto, cadenaCanonica(variante))).not.toEqual(referencia);
    }
  });
});

describe('cabeceras del sobre', () => {
  it('emite kid, marca de tiempo, nonce y firma', () => {
    const cabeceras = construirCabecerasFirma({
      clave,
      metodo: 'POST',
      ruta: '/v1/s2s/qr/sessions',
      cuerpo: '{}',
      ahora: 1_700_000_000_000,
      nonce: 'nonce-fijo',
    });

    expect(cabeceras).toEqual({
      [cabeceraKeyId]: '2026-08',
      [cabeceraMarcaTiempo]: '1700000000000',
      [cabeceraNonce]: 'nonce-fijo',
      [cabeceraFirma]: firmar(
        clave.secreto,
        cadenaCanonica({
          metodo: 'POST',
          ruta: '/v1/s2s/qr/sessions',
          marcaTiempo: 1_700_000_000_000,
          nonce: 'nonce-fijo',
          cuerpo: '{}',
        })
      ),
    });
  });

  it('genera un nonce distinto en cada petición', () => {
    const uno = construirCabecerasFirma({ clave, metodo: 'POST', ruta: '/a', cuerpo: '' });
    const dos = construirCabecerasFirma({ clave, metodo: 'POST', ruta: '/a', cuerpo: '' });

    expect(uno[cabeceraNonce]).not.toEqual(dos[cabeceraNonce]);
  });

  it('nunca incluye el secreto en las cabeceras', () => {
    const cabeceras = construirCabecerasFirma({ clave, metodo: 'POST', ruta: '/a', cuerpo: '' });

    for (const valor of Object.values(cabeceras)) {
      expect(valor).not.toContain(clave.secreto.toString('base64'));
      expect(valor).not.toContain(clave.secreto.toString('base64url'));
    }
  });
});

describe('comparación en tiempo constante', () => {
  it('compara por valor y tolera longitudes distintas', () => {
    expect(igualesEnTiempoConstante('abc', 'abc')).toBe(true);
    expect(igualesEnTiempoConstante('abc', 'abd')).toBe(false);
    expect(igualesEnTiempoConstante('abc', 'abcd')).toBe(false);
    expect(igualesEnTiempoConstante('', '')).toBe(true);
  });
});
