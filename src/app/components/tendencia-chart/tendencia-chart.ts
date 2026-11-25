import { Component, computed, input, signal } from '@angular/core';
import { LecturaSensor } from '../../models/lectura-sensor';

const hora = new Intl.DateTimeFormat('es-AR', { timeStyle: 'medium', hour12: false });
const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

@Component({
  selector: 'app-tendencia-chart',
  standalone: true,
  templateUrl: './tendencia-chart.html',
  styleUrl: './tendencia-chart.css',
})
export class TendenciaChartComponent {
  readonly lecturas = input.required<LecturaSensor[]>();
  protected readonly foco = signal<string | number | null>(null);
  protected readonly serie = computed(() =>
    [...this.lecturas()]
      .sort(
        (a, b) => Date.parse(a.fechaHora) - Date.parse(b.fechaHora) || (a.id ?? 0) - (b.id ?? 0),
      )
      .slice(-30),
  );

  protected readonly escala = computed(() => {
    const temperaturas = this.serie().map((l) => l.temp);
    if (!temperaturas.length) return { min: 0, paso: 10 };
    const min = Math.floor(Math.min(...temperaturas)) - 1;
    const paso = Math.max(1, Math.ceil((Math.max(...temperaturas) + 1 - min) / 4));
    return { min, paso };
  });

  protected readonly niveles = computed(() =>
    [4, 3, 2, 1, 0].map((n) => ({
      y: (4 - n) * 25,
      temp: this.escala().min + n * this.escala().paso,
      humedad: n * 25,
    })),
  );

  protected readonly puntos = computed(() => {
    const datos = this.serie();
    const { min, paso } = this.escala();
    return datos.map((l, i) => ({
      clave: l.id ?? l.fechaHora,
      x: datos.length === 1 ? 50 : (i * 100) / (datos.length - 1),
      t: 100 - ((l.temp - min) * 100) / (4 * paso),
      h: 100 - Math.min(100, Math.max(0, l.humedad)),
      hora: hora.format(new Date(l.fechaHora)),
      valor: numero.format(l.temp),
      humedad: l.humedad,
    }));
  });

  protected readonly temp = computed(() =>
    this.puntos()
      .map((p) => p.x + ',' + p.t)
      .join(' '),
  );
  protected readonly hum = computed(() =>
    this.puntos()
      .map((p) => p.x + ',' + p.h)
      .join(' '),
  );
  protected readonly area = computed(() => {
    const pts = this.puntos();
    return pts.length > 1
      ? pts[0].x + ',100 ' + this.temp() + ' ' + pts[pts.length - 1].x + ',100'
      : '';
  });
  protected readonly activo = computed(() => this.puntos().find((p) => p.clave === this.foco()));
  protected readonly etiquetas = computed(() => {
    const pts = this.puntos();
    return pts.filter(
      (_, i) =>
        i === 0 || i === pts.length - 1 || (pts.length > 3 && i === Math.floor(pts.length / 2)),
    );
  });
}
