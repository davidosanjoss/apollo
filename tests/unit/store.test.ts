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
