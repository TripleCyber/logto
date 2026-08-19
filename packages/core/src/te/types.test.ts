import {
  enmascararDispositivo,
  estadosTerminales,
  interruptoresApagados,
  marcoCanalGuard,
  acotarRitmoSondeo,
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

  it('deja pasar el ritmo que dicta te-api', () => {
    // La tabla propia desapareció: te-api es quien decide, y aquí sólo se acota.
    expect(acotarRitmoSondeo(4000)).toBe(4000);
    expect(acotarRitmoSondeo(1500)).toBe(1500);
  });

  it('el cero pasa tal cual: es «parar», no un ritmo', () => {
    // Confundirlo con «sondea muy rápido» y subirlo al suelo convertiría cada
    // estado terminal en un bucle contra el servidor.
    expect(acotarRitmoSondeo(0)).toBe(0);
    expect(acotarRitmoSondeo(-1)).toBe(0);
    expect(acotarRitmoSondeo(Number.NaN)).toBe(0);
  });

  it('acota lo que llegue: este número acaba en un setTimeout del navegador', () => {
    // Un despliegue mal puesto no puede convertir el sondeo en un bucle cerrado
    // ni congelar la pantalla más que la propia caducidad del reto.
    expect(acotarRitmoSondeo(1)).toBe(1000);
    expect(acotarRitmoSondeo(999)).toBe(1000);
    expect(acotarRitmoSondeo(120_000)).toBe(30_000);
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
