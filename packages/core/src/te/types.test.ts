import {
  enmascararDispositivo,
  estadosTerminales,
  interruptoresApagados,
  marcoCanalGuard,
  ritmoSondeoMs,
  topeDispositivos,
} from './types.js';

describe('enmascarado de dispositivos (C3 con PU-12 dentro)', () => {
  it('devuelve exactamente tres claves, ni una más', () => {
    const enmascarado = enmascararDispositivo({
      deviceRef: 'ref-1',
      kind: 'phone',
      lastSeen: 'today',
    });

    expect(Object.keys(enmascarado)).toEqual(['deviceRef', 'kind', 'lastSeen']);
  });

  it('no deja pasar nombres, modelos ni marcas de tiempo aunque te-api los mande', () => {
    // Campos que te-api no debería mandar, y que aunque mande no pueden llegar al navegador.
    const conExtras: Record<string, string> = {
      deviceRef: 'ref-1',
      kind: 'phone',
      lastSeen: 'today',
      name: 'iPhone de Ana',
      model: 'iPhone 15 Pro',
      platform: 'iOS 18.2',
      lastSeenAt: '2026-08-14T10:00:00.000Z',
      pushToken: 'token',
    };

    const enmascarado = enmascararDispositivo({
      deviceRef: conExtras.deviceRef ?? '',
      kind: conExtras.kind ?? '',
      lastSeen: conExtras.lastSeen ?? '',
      ...conExtras,
    });

    const serializado = JSON.stringify(enmascarado);

    for (const filtracion of ['iPhone de Ana', 'iPhone 15 Pro', 'iOS', '2026-08-14', 'token']) {
      expect(serializado).not.toContain(filtracion);
    }
  });

  it('cae a la etiqueta más gruesa cuando la categoría o la antigüedad son desconocidas', () => {
    expect(
      enmascararDispositivo({ deviceRef: 'r', kind: 'smart-fridge', lastSeen: 'hace un rato' })
    ).toEqual({ deviceRef: 'r', kind: 'phone', lastSeen: 'older' });
  });

  it('el tope de entradas es 5: más allá el número deja de ser ayuda y pasa a ser censo', () => {
    expect(topeDispositivos).toBe(5);
  });
});

describe('marcos y ritmo de sondeo', () => {
  it('rechaza un marco fuera de la unión cerrada', () => {
    expect(marcoCanalGuard.safeParse({ t: 'inventado' }).success).toBe(false);
    expect(marcoCanalGuard.safeParse({ t: 'approved' }).success).toBe(true);
  });

  it('sondea rápido cuando la persona está mirando y despacio mientras se pinta el código', () => {
    expect(ritmoSondeoMs({ t: 'claimed' })).toBe(700);
    expect(ritmoSondeoMs({ t: 'code' })).toBe(1500);
  });

  it('devuelve 0 en cualquier estado terminal, que es la señal de parar', () => {
    for (const tipo of estadosTerminales) {
      expect(ritmoSondeoMs(marcoCanalGuard.parse({ t: tipo }))).toBe(0);
    }
  });

  it('`approved` es terminal pero no desbloquea nada: notifica, no autoriza', () => {
    expect(estadosTerminales.has('approved')).toBe(true);
  });
});

describe('fail-closed', () => {
  it('los interruptores por defecto están todos apagados', () => {
    expect(interruptoresApagados).toEqual({ qr: false, push: false });
  });
});
