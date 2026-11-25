export interface LecturaSensor {
  id?: number;
  fechaHora: string;
  temp: number;
  humedad: number;
  luzPct: number;
  luzEstado: string;
  luzRaw: number;
  gasPct: number;
  gasEstado: string;
  gasRaw: number;
  aguaPct: number;
  aguaEstado: string;
  aguaRaw: number;
  alertaGas: boolean;
  alertaAgua: boolean;
}

export interface EstadisticasLecturas {
  tempMinima: number | null;
  tempMaxima: number | null;
  tempPromedio: number | null;
  humedadMinima: number | null;
  humedadMaxima: number | null;
  humedadPromedio: number | null;
  totalAlertasGas: number;
  totalAlertasAgua: number;
}
