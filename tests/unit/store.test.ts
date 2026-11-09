import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '../../src/main/store';
import { newId } from '../../src/main/store';
import { memoryStore, tempDir } from '../helpers';

let store: Store;
beforeEach(() => { store = memoryStore(); });

const ws = (id: string, name = id) => store.createWorkspace({ id, name, color: '#112233', home: 'apollo://home' });
const tab = (id: string, workspaceId: string, after: string | null = null) =>
  store.insertTab({ id, workspaceId, url: `https://${id}.com/`, title: id }, after);
const order = (workspaceId: string) => store.listTabs(workspaceId).map((t) => t.id);

describe('newId', () => {
  it('gera ids hex de 12 caracteres e únicos', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe('kv', () => {
  it('grava, lê e sobrescreve', () => {
    expect(store.getKv('a')).toBeNull();
    store.setKv('a', '1');
    store.setKv('a', '2');
    expect(store.getKv('a')).toBe('2');
  });
});

describe('workspaces', () => {
  it('lista na ordem de criação', () => {
    ws('a'); ws('b'); ws('c');
    expect(store.listWorkspaces().map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('atualiza nome, cor e página inicial', () => {
    ws('a');
    store.updateWorkspace('a', { name: 'Novo', color: '#ffffff', home: 'https://x.com' });
    expect(store.getWorkspace('a')).toMatchObject({ name: 'Novo', color: '#ffffff', home: 'https://x.com' });
  });

  it('excluir workspace apaga abas e permissões dele (e só dele)', () => {
    ws('a'); ws('b');
    tab('t1', 'a'); tab('t2', 'b');
    store.setPermission('a', 'https://x.com', 'geolocation', 'allow');
    store.setPermission('b', 'https://x.com', 'geolocation', 'deny');
    store.deleteWorkspace('a');
    expect(store.getWorkspace('a')).toBeNull();
    expect(store.getTab('t1')).toBeNull();
    expect(store.getPermission('a', 'https://x.com', 'geolocation')).toBeNull();
    expect(order('b')).toEqual(['t2']);
    expect(store.getPermission('b', 'https://x.com', 'geolocation')).toBe('deny');
  });

  it('guarda a aba ativa', () => {
    ws('a'); tab('t1', 'a');
    store.setActiveTab('a', 't1');
    expect(store.getWorkspace('a')!.activeTabId).toBe('t1');
    store.setActiveTab('a', null);
    expect(store.getWorkspace('a')!.activeTabId).toBeNull();
  });
});

describe('abas', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('sem referência, insere no fim', () => {
    tab('t1', 'a'); tab('t2', 'a'); tab('t3', 'a');
    expect(order('a')).toEqual(['t1', 't2', 't3']);
  });

  it('insere logo depois da aba de referência', () => {
    tab('t1', 'a'); tab('t2', 'a'); tab('t3', 'a');
    tab('n', 'a', 't1');
    expect(order('a')).toEqual(['t1', 'n', 't2', 't3']);
    tab('m', 'a', 't3');
    expect(order('a')).toEqual(['t1', 'n', 't2', 't3', 'm']);
  });

  it('referência de outro workspace é ignorada (vai para o fim)', () => {
    tab('t1', 'a'); tab('x', 'b');
    tab('n', 'a', 'x');
    expect(order('a')).toEqual(['t1', 'n']);
    expect(order('b')).toEqual(['x']);
  });

  it('atualiza só os campos informados', () => {
    tab('t1', 'a');
    store.updateTab('t1', { title: 'Novo' });
    expect(store.getTab('t1')).toMatchObject({ title: 'Novo', url: 'https://t1.com/', favicon: null });
    store.updateTab('t1', { favicon: 'https://t1.com/f.ico', url: 'https://t1.com/b' });
    expect(store.getTab('t1')).toMatchObject({ title: 'Novo', url: 'https://t1.com/b', favicon: 'https://t1.com/f.ico' });
    store.updateTab('t1', {}); // não quebra
  });

  it('excluir aba', () => {
    tab('t1', 'a'); tab('t2', 'a');
    store.deleteTab('t1');
    expect(order('a')).toEqual(['t2']);
  });

  it('aba exige workspace existente', () => {
    expect(() => tab('t1', 'inexistente')).toThrow();
  });
});

describe('permissões', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('são por workspace e por origem', () => {
    store.setPermission('a', 'https://x.com', 'notifications', 'allow');
    expect(store.getPermission('a', 'https://x.com', 'notifications')).toBe('allow');
    expect(store.getPermission('b', 'https://x.com', 'notifications')).toBeNull();
    expect(store.getPermission('a', 'https://y.com', 'notifications')).toBeNull();
    expect(store.getPermission('a', 'https://x.com', 'geolocation')).toBeNull();
  });

  it('sobrescreve e remove (null = voltar ao padrão)', () => {
    store.setPermission('a', 'https://x.com', 'notifications', 'allow');
    store.setPermission('a', 'https://x.com', 'notifications', 'deny');
    expect(store.getPermission('a', 'https://x.com', 'notifications')).toBe('deny');
    store.setPermission('a', 'https://x.com', 'notifications', null);
    expect(store.getPermission('a', 'https://x.com', 'notifications')).toBeNull();
  });
});

describe('importLegacyState (v0.1.0 → SQLite)', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { ({ dir, cleanup } = tempDir()); });
  afterEach(() => cleanup());

  const legacy = {
    activeWorkspaceId: 'w2',
    workspaces: [
      { id: 'w1', name: 'Pessoal', color: '#ff0000', home: 'https://outlook.live.com/mail/', activeTabId: 'x2',
        tabs: [{ id: 'x1', url: 'https://a.com/', title: 'A', favicon: 'https://a.com/f.ico' }, { id: 'x2', url: 'https://b.com/' }] },
      { id: 'w2', name: 'Trabalho', color: '#00ff00', tabs: [{ id: 'y1' }] },
    ],
  };

  it('mantém ids (logins), ordem, aba ativa e workspace ativo; faz backup', () => {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, JSON.stringify(legacy));
    expect(store.importLegacyState(file)).toBe(true);

    expect(store.listWorkspaces().map((w) => [w.id, w.name])).toEqual([['w1', 'Pessoal'], ['w2', 'Trabalho']]);
    expect(store.getWorkspace('w1')!.activeTabId).toBe('x2');
    expect(store.getWorkspace('w2')!.home).toBe('apollo://home');
    expect(order('w1')).toEqual(['x1', 'x2']);
    expect(store.getTab('x1')).toMatchObject({ title: 'A', favicon: 'https://a.com/f.ico' });
    expect(store.getTab('y1')).toMatchObject({ url: 'apollo://home', title: '' });
    expect(store.getKv('activeWorkspaceId')).toBe('w2');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.migrated`)).toBe(true);
  });

  it('não importa se já existem workspaces nem se o arquivo não existe', () => {
    const file = path.join(dir, 'state.json');
    expect(store.importLegacyState(file)).toBe(false);
    ws('atual');
    fs.writeFileSync(file, JSON.stringify(legacy));
    expect(store.importLegacyState(file)).toBe(false);
    expect(store.listWorkspaces().map((w) => w.id)).toEqual(['atual']);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('arquivo sem workspaces é ignorado', () => {
    const file = path.join(dir, 'state.json');
    for (const content of ['{"workspaces": []}', 'null', '[]', '"x"']) {
      fs.writeFileSync(file, content);
      expect(store.importLegacyState(file), content).toBe(false);
    }
  });

  // Regressão: state.json corrompido derrubava a inicialização do app.
  it('arquivo corrompido não impede o app de abrir e é preservado', () => {
    const file = path.join(dir, 'state.json');
    fs.writeFileSync(file, '{"workspaces": [');
    expect(store.importLegacyState(file)).toBe(false);
    expect(store.listWorkspaces()).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('fase 2: posição, histórico e cookies de sessão', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('insertTabAt insere na posição exata (início, meio, fim)', () => {
    tab('t1', 'a'); tab('t2', 'a');
    store.insertTabAt({ id: 'x', workspaceId: 'a', url: 'https://x.com/', title: 'x' }, 0);
    expect(order('a')).toEqual(['x', 't1', 't2']);
    store.insertTabAt({ id: 'y', workspaceId: 'a', url: 'https://y.com/', title: 'y' }, 2);
    expect(order('a')).toEqual(['x', 't1', 'y', 't2']);
    store.insertTabAt({ id: 'z', workspaceId: 'a', url: 'https://z.com/', title: 'z' }, 99);
    expect(order('a')).toEqual(['x', 't1', 'y', 't2', 'z']);
    expect(store.tabIndex('y')).toBe(2);
    expect(store.tabIndex('nao-existe')).toBe(-1);
  });

  // Regressão: insertTabAt usava o índice como posição; depois de excluir abas
  // (posições com buracos) a aba reaberta ia para o lugar errado.
  it('índice continua certo depois de excluir abas (posições com buracos)', () => {
    tab('t1', 'a'); tab('t2', 'a'); tab('t3', 'a');
    store.deleteTab('t1');
    expect(store.tabIndex('t3')).toBe(1);
    store.insertTabAt({ id: 'n', workspaceId: 'a', url: 'https://n.com/', title: 'n' }, 1);
    expect(order('a')).toEqual(['t2', 'n', 't3']);
  });

  it('histórico da aba é salvo, higienizado e lido', () => {
    tab('t1', 'a');
    expect(store.getTab('t1')!.history).toBeNull();
    store.setTabHistory('t1', { index: 1, entries: [{ url: 'https://a.com/', title: 'A', pageState: 'ps' }, { url: 'https://b.com/', title: 'B' }] });
    expect(store.getTab('t1')!.history).toEqual({ index: 1, entries: [{ url: 'https://a.com/', title: 'A', pageState: 'ps' }, { url: 'https://b.com/', title: 'B' }] });
    store.setTabHistory('t1', null);
    expect(store.getTab('t1')!.history).toBeNull();
  });

  it('aba nova pode nascer com histórico (reabrir aba fechada)', () => {
    const t = store.insertTabAt({ id: 'r', workspaceId: 'a', url: 'https://b.com/', title: 'B',
      history: { index: 1, entries: [{ url: 'https://a.com/', title: 'A' }, { url: 'https://b.com/', title: 'B' }] } }, null);
    expect(t.history!.entries).toHaveLength(2);
  });

  it('cookies de sessão por workspace, sobrescritos e apagados com o workspace', () => {
    expect(store.loadSessionCookies('a')).toBeNull();
    store.saveSessionCookies('a', Buffer.from([1, 2, 3]));
    store.saveSessionCookies('a', Buffer.from([4, 5]));
    store.saveSessionCookies('b', Buffer.from([9]));
    expect([...store.loadSessionCookies('a')!]).toEqual([4, 5]);
    store.deleteWorkspace('a');
    expect(store.loadSessionCookies('a')).toBeNull();
    expect([...store.loadSessionCookies('b')!]).toEqual([9]);
  });
});

describe('fase 2b: ordem, fixadas e grupos', () => {
  beforeEach(() => { ws('a'); ws('b'); tab('t1', 'a'); tab('t2', 'a'); tab('t3', 'a'); });

  it('applyOrder grava posição, fixação e grupo', () => {
    store.createGroup({ id: 'g', workspaceId: 'a', name: 'G', color: '#4c8bf5' });
    store.applyOrder('a', [
      { id: 't3', pinned: true, groupId: null },
      { id: 't1', pinned: false, groupId: 'g' },
      { id: 't2', pinned: false, groupId: null },
    ]);
    expect(store.listTabs('a').map((t) => [t.id, t.pinned, t.groupId])).toEqual([['t3', true, null], ['t1', false, 'g'], ['t2', false, null]]);
  });

  it('applyOrder ignora abas de outro workspace', () => {
    tab('x', 'b');
    store.applyOrder('a', [{ id: 'x', pinned: true, groupId: null }]);
    expect(store.getTab('x')!.pinned).toBe(false);
  });

  it('grupo vazio some ao aplicar ordem ou fechar a última aba dele', () => {
    store.createGroup({ id: 'g', workspaceId: 'a', name: 'G', color: '#4c8bf5' });
    store.createGroup({ id: 'h', workspaceId: 'a', name: 'H', color: '#e5534b' });
    store.applyOrder('a', [{ id: 't1', pinned: false, groupId: 'g' }, { id: 't2', pinned: false, groupId: 'h' }, { id: 't3', pinned: false, groupId: null }]);
    expect(store.listGroups('a').map((g) => g.id)).toEqual(['g', 'h']);
    store.deleteTab('t2');
    expect(store.listGroups('a').map((g) => g.id)).toEqual(['g']);
    store.applyOrder('a', [{ id: 't1', pinned: false, groupId: null }, { id: 't3', pinned: false, groupId: null }]);
    expect(store.listGroups('a')).toEqual([]);
  });

  it('atualizar e excluir grupo (abas ficam sem grupo)', () => {
    store.createGroup({ id: 'g', workspaceId: 'a', name: '', color: '#4c8bf5' });
    store.applyOrder('a', [{ id: 't1', pinned: false, groupId: 'g' }, { id: 't2', pinned: false, groupId: null }, { id: 't3', pinned: false, groupId: null }]);
    store.updateGroup('g', { name: 'Faculdade', collapsed: true });
    expect(store.getGroup('g')).toMatchObject({ name: 'Faculdade', color: '#4c8bf5', collapsed: true });
    store.deleteGroup('g');
    expect(store.getTab('t1')!.groupId).toBeNull();
  });

  it('manter sempre ativa', () => {
    store.setKeepAwake('t1', true);
    expect(store.getTab('t1')!.keepAwake).toBe(true);
    store.setKeepAwake('t1', false);
    expect(store.getTab('t1')!.keepAwake).toBe(false);
  });
});

describe('fase 2c: tempo de hibernação por workspace', () => {
  it('padrão 30 min; criar com valor; atualizar sem informar mantém', () => {
    expect(ws('a').hibernateAfterMin).toBe(30);
    expect(store.getWorkspace('a')!.hibernateAfterMin).toBe(30);
    store.createWorkspace({ id: 'b', name: 'B', color: '#000000', home: '', hibernateAfterMin: 0 });
    expect(store.getWorkspace('b')!.hibernateAfterMin).toBe(0);
    store.updateWorkspace('a', { name: 'A', color: '#000000', home: '', hibernateAfterMin: 120 });
    expect(store.getWorkspace('a')!.hibernateAfterMin).toBe(120);
    store.updateWorkspace('a', { name: 'A2', color: '#000000', home: '' });
    expect(store.getWorkspace('a')).toMatchObject({ name: 'A2', hibernateAfterMin: 120 });
  });
});
