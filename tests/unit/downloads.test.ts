import { describe, expect, it } from 'vitest';
import { safeFileName, uniqueName } from '../../src/main/download-names';
import { dayLabel, downloadFraction, downloadStatus, fmtBytes } from '../../src/shared/format';
import type { DownloadInfo } from '../../src/shared/types';

describe('nome do arquivo baixado', () => {
  it('livre: mantém; ocupado: "nome (1).ext", depois (2)…', () => {
    const taken = new Set(['nota.pdf', 'nota (1).pdf']);
    expect(uniqueName('livre.pdf', (n) => taken.has(n))).toBe('livre.pdf');
    expect(uniqueName('nota.pdf', (n) => taken.has(n))).toBe('nota (2).pdf');
  });
  it('extensão dupla e sem extensão', () => {
    expect(uniqueName('dados.tar.gz', (n) => n === 'dados.tar.gz')).toBe('dados (1).tar.gz');
    expect(uniqueName('LEIAME', (n) => n === 'LEIAME')).toBe('LEIAME (1)');
  });
  it('remove separadores e caracteres proibidos; nunca vazio nem oculto', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('a:b*c?.txt')).toBe('a_b_c_.txt');
    expect(safeFileName('...')).toBe('download');
    expect(safeFileName('.bashrc')).toBe('bashrc');
  });
});

describe('formatação', () => {
  it('tamanhos em pt-BR', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1536)).toBe('2 KB');
    expect(fmtBytes(3.25 * 1024 ** 2)).toBe('3,3 MB');
    expect(fmtBytes(1.5 * 1024 ** 3)).toBe('1,5 GB');
  });
  const d = (over: Partial<DownloadInfo>): DownloadInfo => ({ id: '1', filename: 'a', url: '', state: 'progressing', received: 1024 ** 2, total: 4 * 1024 ** 2, startedAt: 0, ...over });
  it('status e fração', () => {
    expect(downloadStatus(d({}))).toBe('1 MB de 4 MB');
    expect(downloadStatus(d({ state: 'paused' }))).toBe('Pausado — 1 MB de 4 MB');
    expect(downloadStatus(d({ total: 0 }))).toBe('1 MB');
    expect(downloadStatus(d({ state: 'completed', received: 4 * 1024 ** 2 }))).toBe('Concluído — 4 MB');
    expect(downloadStatus(d({ state: 'interrupted' }))).toBe('Falhou');
    expect(downloadFraction(d({}))).toBe(0.25);
    expect(downloadFraction(d({ total: 0 }))).toBeNull();
  });
});

describe('dia no histórico', () => {
  it('Hoje, Ontem, dia da semana; ano só se for outro', () => {
    const now = new Date(2026, 10, 10, 15).getTime();
    expect(dayLabel(new Date(2026, 10, 10, 0, 5).getTime(), now)).toBe('Hoje');
    expect(dayLabel(new Date(2026, 10, 9, 23).getTime(), now)).toBe('Ontem');
    expect(dayLabel(new Date(2026, 10, 2, 12).getTime(), now)).toBe('segunda-feira, 2 de novembro');
    expect(dayLabel(new Date(2025, 0, 6, 12).getTime(), now)).toBe('segunda-feira, 6 de janeiro de 2025');
  });
});
