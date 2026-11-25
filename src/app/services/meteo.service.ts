import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { EstadoArduino, PuertosResponse } from '../models/estado-arduino';
import { EstadisticasLecturas, LecturaSensor } from '../models/lectura-sensor';

const ORIGEN = 'http://localhost:5000';
const LIMITE = 30;
const COMANDOS = new Set(['L', 'N', '1', '2', '3', '4', 'S']);

@Injectable({ providedIn: 'root' })
export class MeteoService {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly hub = new HubConnectionBuilder()
    .withUrl(ORIGEN + '/hubs/meteo')
    .withAutomaticReconnect()
    .build();
  private reintento?: ReturnType<typeof setTimeout>;
  private esperaLectura?: ReturnType<typeof setTimeout>;
  private consultaGuardadas?: Subscription;
  private resincronizarAlConectar = false;
  private revisionEstado = 0;
  private consultaPuertos = 0;
  private estadisticasEnCurso = false;
  private estadisticasPendientes = false;
  private readonly comandoEnCurso = signal(false);

  readonly historialEnVivo = signal<LecturaSensor[]>([]);
  readonly registrosGuardados = signal<LecturaSensor[]>([]);
  readonly actualizando = signal<boolean>(false);
  readonly guardando = signal<boolean>(false);
  readonly eliminandoId = signal<number | null>(null);
  readonly cargandoRegistros = signal(false);
  readonly avisoActualizacion = signal('');
  readonly avisoGuardado = signal('');
  readonly avisoEliminacion = signal('');
  readonly lecturaActual = computed(() => this.historialEnVivo().at(-1) ?? null);
  readonly estadisticas = signal<EstadisticasLecturas | null>(null);
  readonly estadoArduino = signal<EstadoArduino | null>(null);
  readonly puertosDisponibles = signal<string[]>([]);
  readonly signalrConectado = signal(false);
  readonly ultimoComandoEnviado = signal<string | null>(null);
  readonly cambiandoPuerto = signal(false);
  readonly cargandoPuertos = signal(false);
  readonly puedeEnviar = computed(
    () =>
      this.signalrConectado() &&
      this.estadoArduino()?.conectado === true &&
      !this.comandoEnCurso() &&
      !this.cambiandoPuerto(),
  );
  readonly errorRegistros = signal('');
  readonly errorEstadisticas = signal('');
  readonly errorPuertos = signal('');
  readonly errorComando = signal('');

  constructor() {
    this.hub.on('NuevaLectura', (lectura: LecturaSensor) => {
      this.historialEnVivo.update((datos) => [...datos.slice(-(LIMITE - 1)), lectura]);
      clearTimeout(this.esperaLectura);
      this.actualizando.set(false);
      this.avisoActualizacion.set('');
      this.estadoArduino.update((estado) =>
        estado ? { ...estado, ultimaLectura: lectura.fechaHora } : null,
      );
    });
    this.hub.on('EstadoConexion', (estado: EstadoArduino) => this.actualizarEstado(estado));
    this.hub.onreconnecting(() => this.signalrConectado.set(false));
    this.hub.onreconnected(() => this.alConectar());
    this.hub.onclose(() => {
      this.signalrConectado.set(false);
      this.programarReintento();
    });
    this.destroy.onDestroy(() => {
      clearTimeout(this.reintento);
      clearTimeout(this.esperaLectura);
      void this.hub.stop();
    });
    this.cargarDatos();
    void this.conectarHub();
  }

  private async conectarHub(): Promise<void> {
    if (this.destroy.destroyed || this.hub.state !== HubConnectionState.Disconnected) return;
    try {
      await this.hub.start();
      if (!this.destroy.destroyed) this.alConectar();
    } catch {
      this.resincronizarAlConectar = true;
      this.programarReintento();
    }
  }

  private programarReintento(): void {
    clearTimeout(this.reintento);
    if (!this.destroy.destroyed) this.reintento = setTimeout(() => void this.conectarHub(), 3000);
  }

  private alConectar(): void {
    this.signalrConectado.set(true);
    if (this.resincronizarAlConectar) this.cargarDatos();
    this.resincronizarAlConectar = true;
  }

  private cargarDatos(): void {
    this.cargarGuardadas();
    this.refrescarEstadisticas();
    this.refrescarPuertos();
  }

  cargarGuardadas(): void {
    this.consultaGuardadas?.unsubscribe();
    this.cargandoRegistros.set(true);
    this.errorRegistros.set('');
    this.consultaGuardadas = this.http
      .get<LecturaSensor[]>(ORIGEN + '/api/lecturas/guardadas')
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.cargandoRegistros.set(false)),
      )
      .subscribe({
        next: (guardadas) => this.registrosGuardados.set(guardadas),
        error: () => this.errorRegistros.set('No se pudieron cargar las mediciones guardadas.'),
      });
  }

  async actualizarAhora(): Promise<void> {
    if (this.actualizando() || !this.puedeEnviar()) return;
    this.actualizando.set(true);
    this.avisoActualizacion.set('');
    this.esperaLectura = setTimeout(() => {
      this.actualizando.set(false);
      this.avisoActualizacion.set('Todavía no se recibió una nueva lectura.');
    }, 2000);
    if (!(await this.enviarComando('S'))) {
      clearTimeout(this.esperaLectura);
      this.actualizando.set(false);
      this.avisoActualizacion.set('No se pudo solicitar la lectura.');
    }
  }

  guardarMedicion(): void {
    const lectura = this.lecturaActual();
    if (!lectura || this.guardando()) return;
    this.guardando.set(true);
    this.avisoGuardado.set('');
    this.http
      .post<LecturaSensor>(ORIGEN + '/api/lecturas/guardar', lectura)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.guardando.set(false)),
      )
      .subscribe({
        next: (captura) => {
          this.registrosGuardados.update((filas) => [
            captura,
            ...filas.filter((f) => f.id !== captura.id),
          ]);
          this.avisoGuardado.set('Medición #' + captura.id + ' guardada en SQL Server.');
          this.sincronizarTrasCambio();
        },
        error: () => this.avisoGuardado.set('No se pudo confirmar el guardado de la medición.'),
      });
  }

  eliminarRegistro(id: number): void {
    if (this.eliminandoId() !== null) return;
    this.eliminandoId.set(id);
    this.avisoEliminacion.set('');
    this.http
      .delete<void>(ORIGEN + '/api/lecturas/' + id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.eliminandoId.set(null)),
      )
      .subscribe({
        next: () => this.quitarRegistro(id),
        error: (error: HttpErrorResponse) => {
          if (error.status === 404) this.quitarRegistro(id);
          else this.avisoEliminacion.set('No se pudo eliminar la medición #' + id + '.');
        },
      });
  }

  private quitarRegistro(id: number): void {
    this.registrosGuardados.update((filas) => filas.filter((f) => f.id !== id));
    this.avisoEliminacion.set('La medición #' + id + ' ya no figura en SQL Server.');
    this.sincronizarTrasCambio();
  }

  private sincronizarTrasCambio(): void {
    // Una consulta iniciada antes de la escritura podría devolver una lista desactualizada.
    if (this.cargandoRegistros() || this.errorRegistros()) this.cargarGuardadas();
    this.refrescarEstadisticas();
  }

  refrescarEstadisticas(): void {
    if (this.estadisticasEnCurso) {
      this.estadisticasPendientes = true;
      return;
    }
    this.estadisticasEnCurso = true;
    this.http
      .get<EstadisticasLecturas>(ORIGEN + '/api/lecturas/estadisticas')
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          this.estadisticasEnCurso = false;
          if (this.estadisticasPendientes && !this.destroy.destroyed) {
            this.estadisticasPendientes = false;
            this.refrescarEstadisticas();
          }
        }),
      )
      .subscribe({
        next: (datos) => {
          this.estadisticas.set(datos);
          this.errorEstadisticas.set('');
        },
        error: () => {
          this.errorEstadisticas.set('No se pudieron actualizar las estadísticas.');
        },
      });
  }

  private actualizarEstado(estado: EstadoArduino): void {
    this.revisionEstado++;
    this.estadoArduino.set(estado);
  }

  refrescarPuertos(): void {
    const consulta = ++this.consultaPuertos;
    const revision = this.revisionEstado;
    this.cargandoPuertos.set(true);
    this.http
      .get<PuertosResponse>(ORIGEN + '/api/sistema/puertos')
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (datos) => {
          if (consulta !== this.consultaPuertos) return;
          const puertos = 'puertos' in datos ? datos.puertos : datos.puertosDisponibles;
          this.puertosDisponibles.set(
            [...new Set(puertos)].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
          );
          if (revision === this.revisionEstado) this.actualizarEstado(datos.estado);
          this.cargandoPuertos.set(false);
          this.errorPuertos.set('');
        },
        error: () => {
          if (consulta !== this.consultaPuertos) return;
          this.cargandoPuertos.set(false);
          this.errorPuertos.set('No se pudieron consultar los puertos.');
        },
      });
  }

  cambiarPuerto(puerto: string): void {
    if (!puerto || this.cambiandoPuerto()) return;
    this.cambiandoPuerto.set(true);
    this.errorPuertos.set('');
    const revision = this.revisionEstado;
    this.http
      .post<EstadoArduino>(ORIGEN + '/api/sistema/puertos', { puerto })
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (estado) => {
          if (revision === this.revisionEstado) this.actualizarEstado(estado);
          this.cambiandoPuerto.set(false);
        },
        error: () => {
          this.errorPuertos.set('No se pudo cambiar el puerto.');
          this.cambiandoPuerto.set(false);
        },
      });
  }

  async enviarComando(cmd: string): Promise<boolean> {
    if (!COMANDOS.has(cmd) || !this.puedeEnviar()) return false;
    this.errorComando.set('');
    this.ultimoComandoEnviado.set(null);
    this.comandoEnCurso.set(true);
    try {
      await this.hub.invoke('EnviarComandoArduino', cmd);
      this.ultimoComandoEnviado.set(cmd);
      return true;
    } catch {
      this.errorComando.set('Falló el envío. Verificá la conexión del Arduino.');
      return false;
    } finally {
      this.comandoEnCurso.set(false);
    }
  }
}
