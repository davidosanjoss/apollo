import { describe, expect, it } from 'vitest';
import type { GroupInfo, TabInfo } from '../../src/shared/types';
import { buildStrip, computeDrop } from '../../src/renderer/tab-strip';

const tab = (id: string, over: Partial<TabInfo> = {}): TabInfo => ({
  id, title: id, url: `https://${id}.com/`, favicon: null, loading: false, canGoBack: false, canGoForward: false,
  dormant: false, pinned: false, keepAwake: false, groupId: null, ...over,
});
const group = (id: string, collapsed = false): GroupInfo => ({ id, name: id.toUpperCase(), color: '#4c8bf5', collapsed });
const keys = (items: ReturnType<typeof buildStrip>) => items.map((i) => (i.kind === 'tab' && i.hidden ? `(${i.key})` : i.key));

describe('buildStrip', () => {
  it('chip do grupo antes do primeiro membro', () => {
    const tabs = [tab('a'), tab('x', { groupId: 'g' }), tab('y', { groupId: 'g' }), tab('b')];
    expect(keys(buildStrip(tabs, [group('g')], 'a'))).toEqual(['t:a', 'g:g', 't:x', 't:y', 't:b']);
    const chip = buildStrip(tabs, [group('g')], 'a')[1];
    expect(chip.kind === 'group' && chip.count).toBe(2);
  });

  it('grupo recolhido esconde as abas, menos a ativa', () => {
    const tabs = [tab('x', { groupId: 'g' }), tab('y', { groupId: 'g' }), tab('b')];
    expect(keys(buildStrip(tabs, [group('g', true)], 'y'))).toEqual(['g:g', '(t:x)', 't:y', 't:b']);
  });

  it('grupos vizinhos têm um chip cada; grupo inexistente é ignorado', () => {
    const tabs = [tab('x', { groupId: 'g' }), tab('y', { groupId: 'h' }), tab('z', { groupId: 'sumiu' })];
    expect(keys(buildStrip(tabs, [group('g'), group('h')], null))).toEqual(['g:g', 't:x', 'g:h', 't:y', 't:z']);
  });
});

describe('computeDrop', () => {
  const tabs = [tab('p', { pinned: true }), tab('a'), tab('x', { groupId: 'g' }), tab('y', { groupId: 'g' }), tab('b')];

  it('antes/depois de uma aba sem grupo', () => {
    expect(computeDrop(tabs, 'b', { kind: 'tab', id: 'a', after: false })).toEqual({ index: 1, groupId: null });
    expect(computeDrop(tabs, 'a', { kind: 'tab', id: 'b', after: true })).toEqual({ index: 4, groupId: null });
  });

  it('sobre uma aba de grupo: entra no grupo', () => {
    expect(computeDrop(tabs, 'b', { kind: 'tab', id: 'x', after: true })).toEqual({ index: 3, groupId: 'g' });
  });

  it('sobre o chip: entra no começo do grupo', () => {
    expect(computeDrop(tabs, 'a', { kind: 'group', id: 'g' })).toEqual({ index: 1, groupId: 'g' });
  });

  it('no espaço vazio: vai para o fim, sem grupo', () => {
    expect(computeDrop(tabs, 'x', { kind: 'end' })).toEqual({ index: 4, groupId: null });
  });

  it('fixada nunca recebe grupo; soltar sobre si mesma não faz nada', () => {
    expect(computeDrop(tabs, 'p', { kind: 'tab', id: 'x', after: false })).toEqual({ index: 1, groupId: undefined });
    expect(computeDrop(tabs, 'a', { kind: 'tab', id: 'a', after: true })).toBeNull();
    expect(computeDrop(tabs, 'nao-existe', { kind: 'end' })).toBeNull();
  });
});
