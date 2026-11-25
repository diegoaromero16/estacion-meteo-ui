import { CommonModule } from '@angular/common';
import { Component, computed, inject, linkedSignal } from '@angular/core';
import { TendenciaChartComponent } from './components/tendencia-chart/tendencia-chart';
import { MeteoService } from './services/meteo.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, TendenciaChartComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly meteo = inject(MeteoService);
  protected readonly puertoActivo = computed(() => this.meteo.estadoArduino()?.puertoActivo ?? '');
  protected readonly opciones = computed(() => [
    ...new Set([...this.meteo.puertosDisponibles(), this.puertoActivo()].filter(Boolean)),
  ]);
  protected readonly seleccion = linkedSignal(
    () => this.puertoActivo() || this.opciones()[0] || '',
  );
  protected readonly puntoRocio = computed(() => {
    const l = this.meteo.lecturaActual();
    if (!l || l.humedad <= 0 || l.humedad > 100) return null;
    const gamma = Math.log(l.humedad / 100) + (17.62 * l.temp) / (243.12 + l.temp);
    return (243.12 * gamma) / (17.62 - gamma);
  });

  protected readonly instrumentos = computed(() => {
    const l = this.meteo.lecturaActual();
    return [
      {
        nombre: 'Radiación / Luz',
        modelo: 'KY-018',
        tema: 'luz',
        icono: 'sol',
        valor: l?.luzPct,
        estado: l?.luzEstado,
        raw: l?.luzRaw,
        alerta: false,
      },
      {
        nombre: 'Calidad de aire',
        modelo: 'MQ-5',
        tema: 'gas',
        icono: 'aire',
        valor: l?.gasPct,
        estado: l?.gasEstado,
        raw: l?.gasRaw,
        alerta: !!l?.alertaGas,
      },
      {
        nombre: 'Precipitación',
        modelo: 'HW-038',
        tema: 'agua',
        icono: 'gota',
        valor: l?.aguaPct,
        estado: l?.aguaEstado,
        raw: l?.aguaRaw,
        alerta: !!l?.alertaAgua,
      },
    ];
  });

  protected readonly comandos = [
    { cmd: 'L', texto: 'Luz LCD', icono: 'lampara' },
    { cmd: 'N', texto: 'Siguiente', icono: 'siguiente' },
    { cmd: '1', texto: 'Clima' },
    { cmd: '2', texto: 'Luz' },
    { cmd: '3', texto: 'Gas' },
    { cmd: '4', texto: 'Agua' },
  ];
}
