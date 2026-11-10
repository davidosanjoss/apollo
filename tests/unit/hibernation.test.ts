import { describe, expect, it } from 'vitest';
import { canHibernate, effectiveTimeout, pickTabsToHibernate, type HibernationCandidate, type HibernationPolicy } from '../../src/main/hibernation';

const MIN = 60_000;
const NOW = 100 * MIN;
const tab = (id: string, over: Partial<HibernationCandidate> = {}): HibernationCandidate => ({
  id, workspaceId: 'w', alive: true, visible: false, keepAwake: false, playingMedia: false,
  unloadBlocked: false, lastSeenAt: NOW - 60 * MIN, memoryMb: 100, workspaceVisible: true, ...over,
});
const policy = (over: Partial<HibernationPolicy> = {}): HibernationPolicy =>
  ({ timeoutMin: () => 30, memoryLimitMb: null, memoryUsedMb: 0, ...over });

describe('canHibernate', () => {
  it('aba comum em segundo plano pode', () => expect(canHibernate(tab('a'))).toBe(true));

  it.each([
    ['na tela', { visible: true }],
    ['sem página carregada', { alive: false }],
    ['sempre ativa', { keepAwake: true }],
    ['tocando mídia', { playingMedia: true }],
    ['formulário não enviado (beforeunload)', { unloadBlocked: true }],
  ])('não hiberna: %s', (_n, over) => expect(canHibernate(tab('a', over))).toBe(false));
});

describe('pickTabsToHibernate — tempo', () => {
  it('hiberna as paradas há mais que o tempo do workspace', () => {
    const tabs = [tab('velha', { lastSeenAt: NOW - 31 * MIN }), tab('recente', { lastSeenAt: NOW - 29 * MIN })];
    expect(pickTabsToHibernate(tabs, policy(), NOW)).toEqual(['velha']);
  });

  it('tempo é por workspace; 0 = nunca', () => {
    const tabs = [tab('trab', { workspaceId: 'trabalho', lastSeenAt: NOW - 10 * MIN }), tab('pes', { workspaceId: 'pessoal', lastSeenAt: NOW - 999 * MIN })];
    const p = policy({ timeoutMin: (t) => (t.workspaceId === 'trabalho' ? 5 : null) });
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['trab']);
  });

  it('respeita as exceções mesmo paradas há muito tempo', () => {
    const tabs = [tab('a', { keepAwake: true }), tab('b', { playingMedia: true }), tab('c', { visible: true })];
    expect(pickTabsToHibernate(tabs, policy(), NOW)).toEqual([]);
  });
});

describe('pickTabsToHibernate — limite de memória', () => {
  const recent = (id: string, ageMin: number, mb: number | null = 100) => tab(id, { lastSeenAt: NOW - ageMin * MIN, memoryMb: mb });
  const noTimeout = { timeoutMin: () => null };

  it('abaixo do limite: nada', () => {
    expect(pickTabsToHibernate([recent('a', 1)], policy({ ...noTimeout, memoryLimitMb: 1000, memoryUsedMb: 900 }), NOW)).toEqual([]);
  });

  it('acima: hiberna as menos usadas recentemente até caber', () => {
    const tabs = [recent('nova', 1, 300), recent('velha', 20, 300), recent('media', 10, 300)];
    const p = policy({ ...noTimeout, memoryLimitMb: 1000, memoryUsedMb: 1500 });
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['velha', 'media']);
  });

  it('conta o que o tempo já liberou', () => {
    const tabs = [recent('expirada', 40, 600), recent('nova', 1, 300)];
    const p = policy({ timeoutMin: () => 30, memoryLimitMb: 1000, memoryUsedMb: 1500 });
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['expirada']);
  });

  it('memória desconhecida: libera uma por rodada', () => {
    const tabs = [recent('a', 30, null), recent('b', 20, null)];
    const p = policy({ ...noTimeout, memoryLimitMb: 100, memoryUsedMb: 5000 });
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['a']);
  });

  it('fixada sem outra exceção hiberna (decisão do usuário: fixar não protege)', () => {
    // Não há campo "pinned" de propósito: fixar não muda a regra.
    expect(pickTabsToHibernate([recent('fixada', 45)], policy(), NOW)).toEqual(['fixada']);
  });
});

describe('effectiveTimeout (regras salvas → minutos)', () => {
  it('regra da aba: 0 = nunca, -1 = ao sair, N = minutos', () => {
    expect(effectiveTimeout(0, null, true)).toBeNull();
    expect(effectiveTimeout(-1, null, true)).toBe(0);
    expect(effectiveTimeout(30, null, true)).toBe(30);
  });

  it('workspace fora da tela: vale a menor das duas; null = mesma regra', () => {
    expect(effectiveTimeout(30, 10, false)).toBe(10);
    expect(effectiveTimeout(5, 10, false)).toBe(5);
    expect(effectiveTimeout(30, -1, false)).toBe(0); // ao sair do workspace
    expect(effectiveTimeout(0, 10, false)).toBe(10); // "nunca" na tela, mas fora dela 10 min
    expect(effectiveTimeout(30, null, false)).toBe(30);
    expect(effectiveTimeout(30, 10, true)).toBe(30); // na tela: só a regra normal
  });
});

describe('pickTabsToHibernate — ao sair e workspace fora da tela', () => {
  it('"ao sair": hiberna assim que sai da tela (exceções continuam valendo)', () => {
    const p = policy({ timeoutMin: () => 0 });
    const tabs = [tab('saiu', { lastSeenAt: NOW }), tab('na tela', { visible: true }), tab('musica', { lastSeenAt: NOW, playingMedia: true })];
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['saiu']);
  });

  it('aba de workspace fora da tela usa a regra mais curta', () => {
    const p = policy({ timeoutMin: (t) => effectiveTimeout(30, 10, t.workspaceVisible) });
    const tabs = [tab('trab', { workspaceVisible: false, lastSeenAt: NOW - 11 * MIN }), tab('aqui', { workspaceVisible: true, lastSeenAt: NOW - 11 * MIN })];
    expect(pickTabsToHibernate(tabs, p, NOW)).toEqual(['trab']);
  });
});
