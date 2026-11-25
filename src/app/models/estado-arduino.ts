export interface EstadoArduino {
  puertoActivo: string;
  conectado: boolean;
  ultimaLectura?: string | null;
  mensajeError?: string | null;
}

// El backend local usa "puertos". También se admite la variante "puertosDisponibles".
export type PuertosResponse = { estado: EstadoArduino } & (
  { puertos: string[] } | { puertosDisponibles: string[] }
);
