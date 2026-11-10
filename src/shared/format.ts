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

/** Rótulo do dia de uma visita: "Hoje", "Ontem" ou "segunda-feira, 9 de novembro". */
export function dayLabel(ts: number, now: number): string {
  const start = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((start(now) - start(ts)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
