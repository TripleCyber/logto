import { analizarMarco, aplicar, esTerminal, estadoInicial, type EstadoCanal } from './machine';

const codigo = (seq: number) => ({
  codeId: `c${seq}`,
  uri: `te://requests/${seq}`,
  seq,
  displayExpiresAt: '2026-08-15T10:00:30.000Z',
  hardExpiresAt: '2026-08-15T10:00:45.000Z',
});

const esperando = (seq: number): EstadoCanal => ({
  nombre: 'esperando',
  seq,
  codigo: codigo(seq),
});

describe('la máquina del canal', () => {
  describe('lo que no está en la unión cerrada no llega a la pantalla', () => {
    it.each([undefined, null, 42, 'code', {}, { t: 'pong' }, { t: 'anything' }])(
      'descarta %p',
      (entrada) => {
        expect(analizarMarco(entrada)).toBeUndefined();
      }
    );

    it('acepta un marco `code` sin código: es «sigo esperando, nada nuevo»', () => {
      expect(analizarMarco({ t: 'code' })).toEqual({ t: 'code' });
    });

    it('descarta el código si le falta un campo o si la fecha no es una fecha', () => {
      expect(analizarMarco({ t: 'code', code: { ...codigo(1), uri: '' } })).toEqual({ t: 'code' });
      expect(analizarMarco({ t: 'code', code: { ...codigo(1), seq: 0 } })).toEqual({ t: 'code' });
      expect(
        analizarMarco({ t: 'code', code: { ...codigo(1), displayExpiresAt: 'mañana' } })
      ).toEqual({ t: 'code' });
    });
  });

  describe('regla 1 · los números de secuencia no retroceden', () => {
    it('ignora un `seq` menor: un marco rancio no repinta un QR muerto', () => {
      const estado = esperando(5);

      expect(aplicar(estado, { t: 'code', code: codigo(4) })).toBe(estado);
    });

    it('ignora un `seq` repetido, porque repintarlo reiniciaría la cuenta atrás', () => {
      const estado = esperando(5);

      expect(aplicar(estado, { t: 'code', code: codigo(5) })).toBe(estado);
    });

    it('acepta un `seq` mayor y se queda con el código nuevo', () => {
      const nuevo = aplicar(esperando(5), { t: 'code', code: codigo(6) });

      expect(nuevo.seq).toBe(6);
      expect(nuevo.codigo?.codeId).toBe('c6');
    });
  });

  describe('regla 2 · los estados terminales no se abandonan', () => {
    it.each(['aprobado', 'rechazado', 'caducado', 'fallo'] as const)(
      'desde `%s` ningún marco devuelve a esperando',
      (nombre) => {
        const estado: EstadoCanal = { nombre, seq: 3 };

        expect(esTerminal(estado)).toBe(true);
        expect(aplicar(estado, { t: 'code', code: codigo(9) })).toBe(estado);
        expect(aplicar(estado, { t: 'claimed', seq: 9 })).toBe(estado);
        expect(aplicar(estado, { t: 'approved' })).toBe(estado);
      }
    );
  });

  describe('regla 3 · `escaneado` sólo avanza hacia un terminal', () => {
    const escaneado: EstadoCanal = { nombre: 'escaneado', seq: 4 };

    it('un marco `code` posterior no devuelve a la pantalla de escanear', () => {
      expect(aplicar(escaneado, { t: 'code', code: codigo(99) })).toBe(escaneado);
    });

    it('otro `claimed` no cambia nada', () => {
      expect(aplicar(escaneado, { t: 'claimed', seq: 99 })).toBe(escaneado);
    });

    it('pero sí avanza a rechazado', () => {
      expect(aplicar(escaneado, { t: 'rejected' }).nombre).toBe('rechazado');
    });
  });

  it('un marco `code` sin código conserva el que ya se está pintando', () => {
    const estado = esperando(2);
    const siguiente = aplicar(estado, { t: 'code' });

    expect(siguiente).toBe(estado);
    expect(siguiente.codigo?.codeId).toBe('c2');
  });

  it('desde el arranque, el primer código pone la pantalla a esperar', () => {
    const siguiente = aplicar(estadoInicial, { t: 'code', code: codigo(1) });

    expect(siguiente).toEqual({ nombre: 'esperando', seq: 1, codigo: codigo(1) });
  });

  it.each([
    ['approved', 'aprobado'],
    ['rejected', 'rechazado'],
    ['expired', 'caducado'],
    ['failed', 'fallo'],
  ] as const)('el marco `%s` lleva a `%s`', (marco, nombre) => {
    expect(aplicar(esperando(1), { t: marco }).nombre).toBe(nombre);
  });
});
