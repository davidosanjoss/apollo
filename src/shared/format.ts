// Formatação para a interface (pt-BR). Puro.
import type { DownloadInfo } from './types';

const nf = (n: number, digits: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${nf(n / 1024, 0)} KB`;
  if (n < 1024 ** 3) return `${nf(n / 1024 ** 2, 1)} MB`;
  return `${nf(n / 1024 ** 3, 2)} GB`;
}

export function downloadStatus(d: DownloadInfo): string {
  const progress = d.total > 0 ? `${fmtBytes(d.received)} de ${fmtBytes(d.total)}` : fmtBytes(d.received);
  switch (d.state) {
    case 'progressing': return progress;
    case 'paused': return `Pausado — ${progress}`;
    case 'completed': return `Concluído — ${fmtBytes(d.total || d.received)}`;
    case 'cancelled': return 'Cancelado';
    case 'interrupted': return 'Falhou';
  }
}

/** Fração concluída (0–1), ou null se o tamanho total é desconhecido. */
export const downloadFraction = (d: DownloadInfo): number | null => (d.total > 0 ? Math.min(1, d.received / d.total) : null);
