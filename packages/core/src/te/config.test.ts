import { analizarClavesHmac, cargarConfigTe } from './config.js';

const secretoValido = Buffer.alloc(32, 1).toString('base64');
const otroSecreto = Buffer.alloc(48, 2).toString('base64');

describe('análisis de TE_LOGTO_HMAC_KEYS', () => {
  it('acepta varias claves y conserva el orden', () => {
    const claves = analizarClavesHmac(`2026-08:${secretoValido}, 2026-05:${otroSecreto}`);

    expect(claves.map(({ kid }) => kid)).toEqual(['2026-08', '2026-05']);
    expect(claves[0]?.secreto).toHaveLength(32);
  });

  it('descarta claves cortas: por debajo de 32 bytes el secreto es adivinable', () => {
    expect(analizarClavesHmac(`corta:${Buffer.alloc(16, 1).toString('base64')}`)).toEqual([]);
  });

  it('descarta entradas sin kid o sin separador', () => {
    expect(analizarClavesHmac(secretoValido)).toEqual([]);
    expect(analizarClavesHmac(`:${secretoValido}`)).toEqual([]);
  });

  it('devuelve vacío si la variable no está', () => {
    const sinVariable: string | undefined = process.env.NO_EXISTE_ESTA_VARIABLE;

    expect(analizarClavesHmac(sinVariable)).toEqual([]);
    expect(analizarClavesHmac('')).toEqual([]);
  });
});

describe('carga de configuración', () => {
  const entornoValido = {
    TE_API_BASE_URL: 'http://127.0.0.1:3010/',
    TE_LOGTO_HMAC_KEYS: `2026-08:${secretoValido},2026-05:${otroSecreto}`,
  };

  it('apaga el canal si falta la URL de te-api', () => {
    expect(
      cargarConfigTe({ TE_LOGTO_HMAC_KEYS: entornoValido.TE_LOGTO_HMAC_KEYS })
    ).toBeUndefined();
  });

  it('apaga el canal si no hay ninguna clave válida', () => {
    expect(cargarConfigTe({ TE_API_BASE_URL: 'http://127.0.0.1:3010' })).toBeUndefined();
    expect(
      cargarConfigTe({ ...entornoValido, TE_LOGTO_HMAC_KEYS: 'kid:demasiado-corto' })
    ).toBeUndefined();
  });

  it('firma con la primera clave salvo que se pida otra explícitamente', () => {
    expect(cargarConfigTe(entornoValido)?.kidActivo).toBe('2026-08');
    expect(cargarConfigTe({ ...entornoValido, TE_HMAC_ACTIVE_KID: '2026-05' })?.kidActivo).toBe(
      '2026-05'
    );
  });

  it('ignora un kid activo que no está en la lista en vez de quedarse sin clave', () => {
    expect(cargarConfigTe({ ...entornoValido, TE_HMAC_ACTIVE_KID: 'inventado' })?.kidActivo).toBe(
      '2026-08'
    );
  });

  it('normaliza la URL base quitando barras finales', () => {
    expect(cargarConfigTe(entornoValido)?.baseUrl).toBe('http://127.0.0.1:3010');
  });

  it('el selector de dispositivos es lazy salvo opt-in explícito', () => {
    expect(cargarConfigTe(entornoValido)?.politicaSelectorDispositivos).toBe('lazy');
    expect(
      cargarConfigTe({ ...entornoValido, TE_PUSH_DEVICE_PICKER: 'cualquier-cosa' })
        ?.politicaSelectorDispositivos
    ).toBe('lazy');
    expect(
      cargarConfigTe({ ...entornoValido, TE_PUSH_DEVICE_PICKER: 'eager' })
        ?.politicaSelectorDispositivos
    ).toBe('eager');
  });

  it('usa valores por defecto sensatos y descarta números inválidos', () => {
    const config = cargarConfigTe({ ...entornoValido, TE_API_TIMEOUT_MS: 'no-es-un-número' });

    expect(config).toMatchObject({
      timeoutMs: 3000,
      maxEnVuelo: 32,
      pisoLatenciaErrorMs: 300,
    });
  });
});

describe('el secreto nunca está en el árbol', () => {
  it('sin entorno no hay clave de repuesto: el canal queda apagado', () => {
    // No hay valor por defecto ni modo «de desarrollo» que funcione sin configurar. Un valor por
    // defecto que funciona es un valor por defecto que se despliega.
    expect(cargarConfigTe({})).toBeUndefined();
  });
});
