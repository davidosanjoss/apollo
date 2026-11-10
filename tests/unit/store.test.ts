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

describe('fase 3: regras de privacidade', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('camadas global, workspace e site são independentes', () => {
    store.setPrivacyRule(null, null, 'ads', false);
    store.setPrivacyRule('a', null, 'trackers', false);
    store.setPrivacyRule('a', 'office.com', 'trackers', true);
    expect(store.getPrivacyLayers('a', 'office.com')).toEqual({ global: { ads: false }, workspace: { trackers: false }, site: { trackers: true } });
    expect(store.getPrivacyLayers('b', 'office.com')).toEqual({ global: { ads: false }, workspace: {}, site: {} });
    expect(store.getPrivacyLayers('a', null).site).toEqual({});
  });

  it('sobrescreve e remove (null = volta a herdar)', () => {
    store.setPrivacyRule('a', 'x.com', 'ads', false);
    store.setPrivacyRule('a', 'x.com', 'ads', true);
    expect(store.getPrivacyLayers('a', 'x.com').site).toEqual({ ads: true });
    store.setPrivacyRule('a', 'x.com', 'ads', null);
    expect(store.getPrivacyLayers('a', 'x.com').site).toEqual({});
  });

  it('excluir o workspace apaga as regras dele', () => {
    store.setPrivacyRule('a', 'x.com', 'ads', false);
    store.setPrivacyRule('a', null, 'ads', false);
    store.deleteWorkspace('a');
    store.createWorkspace({ id: 'a', name: 'A', color: '#000000', home: '' });
    expect(store.getPrivacyLayers('a', 'x.com')).toEqual({ global: {}, workspace: {}, site: {} });
  });

  it('regra de site sem workspace é erro de programação', () => {
    expect(() => store.setPrivacyRule(null, 'x.com', 'ads', false)).toThrow();
  });
});

describe('fase 3d: workspace temporário', () => {
  it('marcado como temporário e apagado (com abas e regras) por deleteTemporaryWorkspaces', () => {
    ws('fixo');
    store.createWorkspace({ id: 'tmp', name: 'Temp', color: '#000000', home: '', temporary: true });
    tab('t1', 'tmp');
    store.setPrivacyRule('tmp', 'x.com', 'ads', false);
    expect(store.getWorkspace('tmp')!.temporary).toBe(true);
    expect(store.getWorkspace('fixo')!.temporary).toBe(false);
    expect(store.deleteTemporaryWorkspaces()).toEqual(['tmp']);
    expect(store.getWorkspace('tmp')).toBeNull();
    expect(store.getTab('t1')).toBeNull();
    expect(store.listWorkspaces().map((w) => w.id)).toEqual(['fixo']);
    expect(store.deleteTemporaryWorkspaces()).toEqual([]);
  });
});

describe('fase 5b: painéis laterais', () => {
  it('criar, listar em ordem, atualizar e apagar; somem com o workspace', () => {
    ws('a'); ws('b');
    store.createPanel({ id: 'p1', workspaceId: 'a', url: 'https://web.whatsapp.com', mobile: false });
    store.createPanel({ id: 'p2', workspaceId: 'b', url: 'https://teams.microsoft.com', mobile: true });
    expect(store.listPanels().map((p) => [p.id, p.workspaceId, p.width, p.mobile])).toEqual([['p1', 'a', 420, false], ['p2', 'b', 420, true]]);
    store.updatePanel('p1', { title: 'WhatsApp', width: 500 });
    expect(store.getPanel('p1')).toMatchObject({ title: 'WhatsApp', width: 500, url: 'https://web.whatsapp.com' });
    store.deleteWorkspace('b');
    expect(store.listPanels().map((p) => p.id)).toEqual(['p1']);
    store.deletePanel('p1');
    expect(store.listPanels()).toEqual([]);
  });
});

describe('fase 5c: personalizações', () => {
  it('criar, editar (mesmo id), listar em ordem e apagar', () => {
    const c = { id: 'c1', name: 'YouTube limpo', sites: 'youtube.com', css: '#comments{display:none}', js: '', enabled: true };
    store.saveCustomization(c);
    store.saveCustomization({ ...c, id: 'c2', name: 'Moodle', sites: 'moodle.ufmg.br' });
    store.saveCustomization({ ...c, enabled: false, js: 'document.title = 1' });
    expect(store.listCustomizations()).toEqual([
      { ...c, enabled: false, js: 'document.title = 1' },
      { ...c, id: 'c2', name: 'Moodle', sites: 'moodle.ufmg.br' },
    ]);
    store.deleteCustomization('c1');
    expect(store.listCustomizations().map((x) => x.id)).toEqual(['c2']);
  });
});

describe('v7: hibernação do workspace fora da tela e de painéis', () => {
  it('padrão 10 min; null = mesma regra; atualizar sem informar mantém', () => {
    ws('a');
    expect(store.getWorkspace('a')!.hiddenHibernateMin).toBe(10);
    store.updateWorkspace('a', { name: 'A', color: '#000000', home: '', hiddenHibernateMin: null });
    expect(store.getWorkspace('a')!.hiddenHibernateMin).toBeNull();
    store.updateWorkspace('a', { name: 'A', color: '#000000', home: '', hiddenHibernateMin: -1 });
    store.updateWorkspace('a', { name: 'A2', color: '#000000', home: '' });
    expect(store.getWorkspace('a')).toMatchObject({ name: 'A2', hiddenHibernateMin: -1 });
  });

  it('painel: sempre ativo por padrão; regra salva', () => {
    ws('a');
    store.createPanel({ id: 'p', workspaceId: 'a', url: 'https://x.com', mobile: false });
    expect(store.getPanel('p')!.hibernateMin).toBeNull();
    store.updatePanel('p', { hibernateMin: 0 });
    expect(store.getPanel('p')!.hibernateMin).toBe(0);
    store.updatePanel('p', { title: 'X' });
    expect(store.getPanel('p')).toMatchObject({ title: 'X', hibernateMin: 0 });
  });
});

describe('atualizações parciais', () => {
  // Regressão: { ...atual, ...patch } com campos undefined sobrescrevia os salvos —
  // arrastar a largura do painel desligava a "versão para celular" (e o SQLite
  // recusava gravar undefined, travando o app).
  it('updatePanel ignora campos undefined', () => {
    ws('a');
    store.createPanel({ id: 'p', workspaceId: 'a', url: 'https://x.com', mobile: true });
    store.updatePanel('p', { hibernateMin: 30 });
    store.updatePanel('p', { width: 500, mobile: undefined, hibernateMin: undefined });
    expect(store.getPanel('p')).toMatchObject({ width: 500, mobile: true, hibernateMin: 30 });
  });

  it('updateGroup ignora campos undefined', () => {
    ws('a');
    store.createGroup({ id: 'g', workspaceId: 'a', name: 'Faculdade', color: '#4c8bf5' });
    store.updateGroup('g', { collapsed: true, name: undefined });
    expect(store.getGroup('g')).toMatchObject({ name: 'Faculdade', color: '#4c8bf5', collapsed: true });
  });
});

describe('v8: favoritos', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('por workspace, em ordem; achar pela URL ignora #fragmento e barra final', () => {
    store.addBookmark({ id: 'f1', workspaceId: 'a', title: 'Moodle', url: 'https://moodle.ufmg.br/', favicon: null });
    store.addBookmark({ id: 'f2', workspaceId: 'a', title: 'Outlook', url: 'https://outlook.office.com/mail', favicon: null });
    store.addBookmark({ id: 'f3', workspaceId: 'b', title: 'Banco', url: 'https://banco.com', favicon: null });
    expect(store.listBookmarks('a').map((b) => b.id)).toEqual(['f1', 'f2']);
    expect(store.listBookmarks('b').map((b) => b.id)).toEqual(['f3']);
    expect(store.findBookmark('a', 'https://moodle.ufmg.br#topo')?.id).toBe('f1');
    expect(store.findBookmark('a', 'https://outlook.office.com/mail/')?.id).toBe('f2');
    expect(store.findBookmark('b', 'https://moodle.ufmg.br/')).toBeNull(); // outro workspace
  });

  it('renomear, reordenar, remover; somem com o workspace', () => {
    for (const id of ['x', 'y', 'z']) store.addBookmark({ id, workspaceId: 'a', title: id, url: `https://${id}.com`, favicon: null });
    store.renameBookmark('x', 'Xis');
    store.moveBookmark('z', null, 0);
    expect(store.listBookmarks('a').map((b) => b.title)).toEqual(['z', 'Xis', 'y']);
    store.removeBookmark('x');
    expect(store.listBookmarks('a').map((b) => b.id)).toEqual(['z', 'y']);
    store.deleteWorkspace('a');
    expect(store.listBookmarks('a')).toEqual([]);
  });
});

describe('v9: zoom por site', () => {
  beforeEach(() => { ws('a'); ws('b'); });
  it('por workspace e host; 100% apaga (padrão)', () => {
    expect(store.getZoom('a', 'moodle.ufmg.br')).toBe(1);
    store.setZoom('a', 'moodle.ufmg.br', 1.25);
    store.setZoom('a', 'moodle.ufmg.br', 1.5);
    expect(store.getZoom('a', 'moodle.ufmg.br')).toBe(1.5);
    expect(store.getZoom('b', 'moodle.ufmg.br')).toBe(1);
    store.setZoom('a', 'moodle.ufmg.br', 1);
    expect(store.getZoom('a', 'moodle.ufmg.br')).toBe(1);
    store.setZoom('a', 'x.com', 2);
    store.deleteWorkspace('a');
    expect(store.getZoom('a', 'x.com')).toBe(1);
  });
});

describe('v10: histórico de visitas', () => {
  beforeEach(() => { ws('a'); ws('b'); });

  it('conta visitas, mantém o título, busca sem acento com todas as palavras', () => {
    store.recordVisit('a', 'https://moodle.ufmg.br/course/view.php?id=1', 'Cálculo Diferencial', 1000);
    store.recordVisit('a', 'https://moodle.ufmg.br/course/view.php?id=1', '', 2000); // título ainda não chegou
    store.recordVisit('a', 'https://www.ufmg.br/', 'Portal UFMG', 1500);
    const r = store.searchHistory('a', 'CALCULO moodle');
    expect(r).toEqual([{ url: 'https://moodle.ufmg.br/course/view.php?id=1', title: 'Cálculo Diferencial', visits: 2, lastVisit: 2000 }]);
    expect(store.searchHistory('a', 'ufmg').map((x) => x.title)).toEqual(['Cálculo Diferencial', 'Portal UFMG']);
    expect(store.searchHistory('b', 'ufmg')).toEqual([]); // outro workspace
    expect(store.searchHistory('a', '   ')).toEqual([]);
  });

  it('título que chega depois entra na busca; % e _ são literais', () => {
    store.recordVisit('a', 'https://x.com/a', '', 1);
    store.setVisitTitle('a', 'https://x.com/a', 'Relatório 100%');
    expect(store.searchHistory('a', 'relatorio').length).toBe(1);
    expect(store.searchHistory('a', '100%').length).toBe(1);
    expect(store.searchHistory('a', '_').length).toBe(0);
  });

  it('poda por idade e por quantidade; apagar tudo', () => {
    const day = 86_400_000;
    const now = 200 * day;
    store.recordVisit('a', 'https://velho.com', 'Velho', now - 100 * day);
    for (let i = 0; i < 5; i++) store.recordVisit('a', `https://n${i}.com`, `N${i}`, now - i);
    store.pruneHistory(90, 3, now);
    expect(store.searchHistory('a', 'com', 50).map((x) => x.title).sort()).toEqual(['N0', 'N1', 'N2']);
    store.clearHistory();
    expect(store.searchHistory('a', 'com')).toEqual([]);
  });
});

describe('v11: pastas de favoritos', () => {
  beforeEach(() => { ws('a'); ws('b'); });
  const add = (id: string, parentId: string | null = null) => store.addBookmark({ id, workspaceId: 'a', title: id, url: `https://${id}.com`, favicon: null, parentId });
  const kids = (parentId: string | null) => store.childBookmarks('a', parentId).map((b) => b.id);

  it('pastas e subpastas; cada nível com a própria ordem', () => {
    add('x');
    store.addFolder({ id: 'f', workspaceId: 'a', title: 'Faculdade' });
    store.addFolder({ id: 'sub', workspaceId: 'a', title: 'Cálculo', parentId: 'f' });
    add('m', 'f');
    add('n', 'sub');
    expect(kids(null)).toEqual(['x', 'f']);
    expect(kids('f')).toEqual(['sub', 'm']);
    expect(kids('sub')).toEqual(['n']);
    expect(store.getBookmark('f')).toMatchObject({ folder: true, url: '', parentId: null });
    expect(store.findBookmark('a', 'https://n.com')?.id).toBe('n');
  });

  it('pai inválido (outro workspace, não é pasta) vira raiz', () => {
    store.addFolder({ id: 'fb', workspaceId: 'b', title: 'B' });
    add('x', 'fb');
    add('y', 'x');
    expect(kids(null)).toEqual(['x', 'y']);
  });

  it('mover entre pastas; pasta nunca entra nela mesma nem numa subpasta dela', () => {
    store.addFolder({ id: 'f', workspaceId: 'a', title: 'F' });
    store.addFolder({ id: 'sub', workspaceId: 'a', title: 'S', parentId: 'f' });
    add('x');
    store.moveBookmark('x', 'sub', 0);
    expect(kids('sub')).toEqual(['x']);
    store.moveBookmark('x', null, 0);
    expect(kids(null)).toEqual(['x', 'f']);
    store.moveBookmark('f', 'sub', 0); // ciclo: ignorado
    store.moveBookmark('f', 'f', 0);
    expect(store.getBookmark('f')!.parentId).toBeNull();
    store.moveBookmark('x', 'x', 0); // não é pasta: ignorado
    expect(store.getBookmark('x')!.parentId).toBeNull();
  });

  it('excluir pasta leva tudo dentro (subpastas inclusive); editar URL de pasta é ignorado', () => {
    store.addFolder({ id: 'f', workspaceId: 'a', title: 'F' });
    store.addFolder({ id: 'sub', workspaceId: 'a', title: 'S', parentId: 'f' });
    add('m', 'f');
    add('n', 'sub');
    add('fora');
    store.updateBookmark('f', { title: 'F2', url: 'https://x.com' });
    expect(store.getBookmark('f')).toMatchObject({ title: 'F', url: '' });
    store.removeBookmark('f');
    expect(store.listBookmarks('a').map((b) => b.id)).toEqual(['fora']);
  });
});

describe('v12: lista de downloads', () => {
  const d = (id: string, startedAt: number, state: 'completed' | 'progressing' = 'completed') =>
    ({ id, filename: `${id}.pdf`, url: `https://x.com/${id}`, path: `/tmp/${id}.pdf`, state, received: 10, total: 10, startedAt });
  it('grava, atualiza, lista desde uma data (recentes primeiro), poda e apaga', () => {
    store.saveDownload(d('a', 100));
    store.saveDownload(d('b', 200, 'progressing'));
    store.saveDownload({ ...d('b', 200), filename: 'b (1).pdf' });
    expect(store.listDownloads(0).map((x) => [x.id, x.state, x.filename])).toEqual([['b', 'completed', 'b (1).pdf'], ['a', 'completed', 'a.pdf']]);
    expect(store.listDownloads(150).map((x) => x.id)).toEqual(['b']);
    store.pruneDownloads(150);
    expect(store.listDownloads(0).map((x) => x.id)).toEqual(['b']);
    store.deleteDownload('b');
    store.saveDownload(d('c', 1));
    store.pruneDownloads(Infinity);
    expect(store.listDownloads(0)).toEqual([]);
  });
});

describe('sincronização: ponte com os dados locais', () => {
  it('retrato com ids dos outros computadores; aplicar cria, move e apaga', async () => {
    const { snapshot, apply, matchWorkspaces } = await import('../../src/main/sync/local');
    const { merge3, diff, emptyData } = await import('../../src/main/sync/merge');
    ws('loc'); // "Principal" deste computador
    store.updateWorkspace('loc', { name: 'Principal', color: '#111111', home: '' });
    store.addFolder({ id: 'f', workspaceId: 'loc', title: 'Faculdade' });
    store.addBookmark({ id: 'm', workspaceId: 'loc', title: 'Moodle', url: 'https://moodle.ufmg.br', favicon: null, parentId: 'f' });
    store.createWorkspace({ id: 'tmp', name: 'Temp', color: '#000000', home: '', temporary: true });
    store.setKv('spellcheck', 'pt');

    // Nuvem (outro PC): "Principal" com outro id, um favorito e um workspace "Banco".
    const remote = emptyData();
    remote.workspaces.R = { name: 'principal ', color: '#222222', home: '', hibernateAfterMin: 30, hiddenHibernateMin: 10, position: 0 };
    remote.workspaces.B = { name: 'Banco', color: '#333333', home: '', hibernateAfterMin: 30, hiddenHibernateMin: 10, position: 1 };
    remote.bookmarks.x = { workspaceId: 'R', parentId: null, folder: false, title: 'Outlook', url: 'https://outlook.com', position: 0 };

    const map = matchWorkspaces(store, remote, {});
    expect(map).toEqual({ loc: 'R' });
    const local = snapshot(store, map);
    expect(Object.keys(local.workspaces)).toEqual(['R']); // temporário fica de fora
    expect(local.bookmarks.m).toMatchObject({ workspaceId: 'R', parentId: 'f' });
    expect(local.prefs).toEqual({ spellcheck: 'pt' });

    const merged = merge3(emptyData(), local, remote);
    const hooks = { deleted: [] as string[], done: [] as string[][] };
    apply(store, map, merged, diff(local, merged), {
      deleteWorkspace: (id) => hooks.deleted.push(id), removePanel: () => {}, reloadPanel: () => {}, done: (p) => hooks.done.push(p),
    });
    expect(store.getWorkspace('B')?.name).toBe('Banco'); // criado com o id de lá
    expect(store.listBookmarks('loc').map((b) => b.title).sort()).toEqual(['Faculdade', 'Moodle', 'Outlook']); // no workspace local
    expect(snapshot(store, map)).toEqual(merged); // ida e volta batem

    // Remoto apagou o favorito da pasta e o workspace Banco.
    const remote2 = structuredClone(merged);
    delete remote2.bookmarks.m;
    delete remote2.workspaces.B;
    const merged2 = merge3(merged, snapshot(store, map), remote2);
    apply(store, map, merged2, diff(snapshot(store, map), merged2), {
      deleteWorkspace: (id) => hooks.deleted.push(id), removePanel: () => {}, reloadPanel: () => {}, done: () => {},
    });
    expect(store.listBookmarks('loc').map((b) => b.title).sort()).toEqual(['Faculdade', 'Outlook']);
    expect(hooks.deleted).toEqual(['B']);
  });
});
