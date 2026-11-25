import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HubConnection } from '@microsoft/signalr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppComponent } from './app.component';
import { LecturaSensor } from './models/lectura-sensor';

const api = 'http://localhost:5000/api';
const estado = { puertoActivo: 'COM6', conectado: true, ultimaLectura: null, mensajeError: null };

function lectura(id: number): LecturaSensor {
  return {
    id,
    fechaHora: new Date(Date.UTC(2026, 0, 1, 10, 0, id)).toISOString(),
    temp: 24.5,
    humedad: 52,
    luzPct: 78,
    luzEstado: 'Brillante',
    luzRaw: 225,
    gasPct: 15,
    gasEstado: 'Normal',
    gasRaw: 154,
    aguaPct: 0,
    aguaEstado: 'Seco',
    aguaRaw: 0,
    alertaGas: false,
    alertaAgua: false,
  };
}

describe('Consola meteorológica', () => {
  beforeEach(() => {
    vi.spyOn(HubConnection.prototype, 'start').mockImplementation(
      () => new Promise<void>(() => {}),
    );
    TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.restoreAllMocks();
  });

  function abrir() {
    const eventos = vi.spyOn(HubConnection.prototype, 'on');
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    const guardadas = http.expectOne(api + '/lecturas/guardadas');
    const stats = http.expectOne(api + '/lecturas/estadisticas');
    const puertos = http.expectOne(api + '/sistema/puertos');
    return {
      fixture,
      http,
      guardadas,
      stats,
      puertos,
      meteo: fixture.componentInstance.meteo,
      emitir: (nombre: string, dato: unknown) => {
        const evento = eventos.mock.calls.find(([registrado]) => registrado === nombre);
        if (!evento) throw new Error('Evento no registrado: ' + nombre);
        evento[1](dato);
      },
    };
  }

  it('muestra el estado vacío y los puertos del backend local', () => {
    const { fixture, guardadas, stats, puertos, meteo } = abrir();
    guardadas.flush([]);
    stats.flush({ totalAlertasAgua: 0, totalAlertasGas: 0 });
    puertos.flush({ puertos: ['COM8', 'COM6'], estado });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('h1')?.textContent).toContain('Estación meteorológica');
    expect(root.querySelector('select')?.value).toBe('COM6');
    expect(meteo.puertosDisponibles()).toEqual(['COM6', 'COM8']);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('Esperando lecturas');
  });

  it('mantiene las 30 lecturas en vivo separadas de SQL', () => {
    const { fixture, guardadas, stats, puertos, meteo, emitir, http } = abrir();
    guardadas.flush([lectura(90)]);
    expect(meteo.lecturaActual()).toBeNull();
    stats.flush({});
    for (let i = 1; i <= 31; i++) emitir('NuevaLectura', lectura(i));
    const ultima = { ...lectura(32), alertaGas: true, gasEstado: 'Alerta' };
    emitir('NuevaLectura', ultima);
    emitir('EstadoConexion', { ...estado, puertoActivo: 'COM8' });
    puertos.flush({ puertosDisponibles: ['COM8'], estado });
    fixture.detectChanges();
    expect(meteo.historialEnVivo().map((l) => l.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 3),
    );
    expect(meteo.registrosGuardados()).toEqual([lectura(90)]);
    expect(meteo.lecturaActual()).toEqual(ultima);
    expect(meteo.estadoArduino()?.puertoActivo).toBe('COM8');
    http.expectNone(api + '/lecturas/guardar');
    http.expectNone(api + '/lecturas/estadisticas');
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Gas detectado');
    expect(root.querySelectorAll('app-tendencia-chart rect')).toHaveLength(30);
    expect(root.querySelectorAll('.historial tbody tr')).toHaveLength(1);
    root.querySelector('app-tendencia-chart rect')!.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(root.querySelector('.tooltip')?.textContent).toContain('52 %');
  });

  it('envía S una sola vez por solicitud y deja de esperar al recibir la trama o a los dos segundos', async () => {
    const { guardadas, stats, puertos, meteo, emitir } = abrir();
    guardadas.flush([]);
    stats.flush({});
    puertos.flush({ puertos: [], estado });
    meteo.signalrConectado.set(true);
    const enviar = vi.spyOn(HubConnection.prototype, 'invoke').mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      const primera = meteo.actualizarAhora();
      await meteo.actualizarAhora();
      await primera;
      expect(enviar).toHaveBeenCalledExactlyOnceWith('EnviarComandoArduino', 'S');
      expect(meteo.actualizando()).toBe(true);
      emitir('NuevaLectura', lectura(1));
      expect(meteo.actualizando()).toBe(false);
      await meteo.actualizarAhora();
      vi.advanceTimersByTime(2000);
      expect(meteo.actualizando()).toBe(false);
      expect(meteo.avisoActualizacion()).toContain('Todavía');
      expect(meteo.registrosGuardados()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('guarda la lectura elegida aunque llegue otra y elimina solo la captura confirmada', () => {
    const { fixture, guardadas, stats, puertos, meteo, emitir, http } = abrir();
    guardadas.flush([lectura(7)]);
    stats.flush({});
    puertos.flush({ puertos: [], estado });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const guardar = root.querySelector<HTMLButtonElement>('.titulo-seccion .primario')!;
    expect(guardar.disabled).toBe(true);
    const muestra = lectura(1);
    emitir('NuevaLectura', muestra);
    fixture.detectChanges();
    guardar.click();
    meteo.guardarMedicion();
    const alta = http.expectOne({ method: 'POST', url: api + '/lecturas/guardar' });
    expect(alta.request.body).toEqual(muestra);
    expect(meteo.guardando()).toBe(true);
    emitir('NuevaLectura', lectura(2));
    const captura = { ...muestra, id: 8, fechaHora: '2026-01-05T12:34:56' };
    alta.flush(captura, { status: 201, statusText: 'Created' });
    http.expectOne(api + '/lecturas/estadisticas').flush({});
    fixture.detectChanges();
    expect(root.querySelector('.historial time')?.textContent).toContain('05/01/2026 12:34:56');
    expect(meteo.registrosGuardados()).toEqual([captura, lectura(7)]);
    expect(meteo.lecturaActual()).toEqual(lectura(2));
    expect(meteo.avisoGuardado()).toContain('#8');
    meteo.eliminarRegistro(8);
    const baja = http.expectOne({ method: 'DELETE', url: api + '/lecturas/8' });
    expect(meteo.registrosGuardados()).toHaveLength(2);
    baja.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne(api + '/lecturas/estadisticas').flush({});
    expect(meteo.registrosGuardados()).toEqual([lectura(7)]);
    expect(meteo.historialEnVivo()).toHaveLength(2);
  });

  it('envía el comando permitido por el hub y refleja el estado de un cambio de puerto', async () => {
    const { meteo, http, puertos, guardadas, stats } = abrir();
    guardadas.flush([]);
    stats.flush({});
    puertos.flush({ puertos: ['COM8'], estado });
    const enviar = vi.spyOn(HubConnection.prototype, 'invoke').mockResolvedValue(undefined);
    await meteo.enviarComando('S');
    expect(enviar).not.toHaveBeenCalled();
    meteo.signalrConectado.set(true);
    await meteo.enviarComando('XX');
    expect(enviar).not.toHaveBeenCalled();
    await meteo.enviarComando('L');
    expect(enviar).toHaveBeenCalledWith('EnviarComandoArduino', 'L');
    expect(meteo.ultimoComandoEnviado()).toBe('L');
    meteo.cambiarPuerto('COM8');
    const cambio = http.expectOne({ method: 'POST', url: api + '/sistema/puertos' });
    expect(cambio.request.body).toEqual({ puerto: 'COM8' });
    cambio.flush(
      { ...estado, puertoActivo: 'COM8', conectado: false, mensajeError: 'Ocupado' },
      { status: 202, statusText: 'Accepted' },
    );
    expect(meteo.estadoArduino()?.mensajeError).toBe('Ocupado');
    expect(meteo.puedeEnviar()).toBe(false);
  });
});
