import { describe, expect, it } from 'vitest';
import { buildItems, fold, fuzzyScore, rank, readableUrl, type PaletteItem } from '../../src/renderer/palette';
import type { UiState } from '../../src/shared/types';

const item = (title: string, detail = ''): PaletteItem => ({ id: title, title, detail, group: 'Ações', action: { kind: 'ui', action: 'settings' } });

describe('fold', () => {
  it('sem acentos e minúsculo', () => expect(fold('Configurações ÁÉ')).toBe('configuracoes ae'));
});

describe('fuzzyScore', () => {
  it('letras em ordem casam; fora de ordem não', () => {
    expect(fuzzyScore('cfg', 'Configurações')).not.toBeNull();
    expect(fuzzyScore('gfc', 'Configurações')).toBeNull();
  });

  it('acentos não importam', () => {
    expect(fuzzyScore('configuracoes', 'Configurações')).not.toBeNull();
    expect(fuzzyScore('memória', 'Monitor de memoria')).not.toBeNull();
  });

  it('começo de palavra e sequência valem mais', () => {
    expect(fuzzyScore('nova', 'Nova aba')!).toBeGreaterThan(fuzzyScore('nova', 'Reabrir uma aba fechada novamente')!);
    expect(fuzzyScore('mon', 'Monitor de memória')!).toBeGreaterThan(fuzzyScore('mon', 'Hibernar outras abas (memória livre ONline)')!);
  });

  it('busca vazia: tudo vale 0', () => expect(fuzzyScore('  ', 'x')).toBe(0));
});

describe('rank', () => {
  const items = [item('Nova aba'), item('Configurações'), item('Moodle — Aula 3', 'moodle.ufmg.br'), item('Monitor de memória')];

  it('sem busca: mantém a ordem', () => expect(rank(items, '')).toEqual(items));

  it('filtra e ordena pelo melhor', () => {
    expect(rank(items, 'mo').map((i) => i.title)).toEqual(['Moodle — Aula 3', 'Monitor de memória']);
    expect(rank(items, 'conf').map((i) => i.title)).toEqual(['Configurações']);
  });

  it('acha pelo detalhe (URL) também', () => {
    expect(rank(items, 'ufmg').map((i) => i.title)).toEqual(['Moodle — Aula 3']);
  });
});

// ------------------------------------------------------------ itens

const tab = (id: string, title: string, over: object = {}) => ({ id, title, url: `https://${id}.com/`, favicon: null, loading: false,
  canGoBack: false, canGoForward: false, dormant: false, live: true, pinned: false, keepAwake: false, groupId: null, ...over });
const ws = (id: string, name: string) => ({ id, name, color: '#000000', home: '', hibernateAfterMin: 30, privacy: {} as never, temporary: false });

function state(over: Partial<UiState> = {}): UiState {
  return {
    workspaces: [ws('w1', 'Pessoal'), ws('w2', 'Trabalho')], activeWorkspaceId: 'w1',
    tabs: [tab('a', 'Aba atual')], groups: [], activeTabId: 'a',
    paletteTabs: [{ id: 'a', title: 'Aba atual', url: 'https://a.com/', workspaceId: 'w1' }, { id: 't', title: 'Teams', url: 'https://teams.microsoft.com/', workspaceId: 'w2' }],
    vault: { status: 'disconnected' } as UiState['vault'], vaultSite: null, sitePrivacy: null, memory: null,
    ...over,
  } as UiState;
}

describe('readableUrl', () => {
  it('sem esquema e decodificada', () => {
    expect(readableUrl('https://a.com/page?title=Moodle%20%E2%80%94%20C%C3%A1lculo')).toBe('a.com/page?title=Moodle — Cálculo');
    expect(readableUrl('https://a.com/%E0%A4%A')).toBe('a.com/%E0%A4%A'); // malformada
  });
});

describe('buildItems', () => {
  it('abas de todos os workspaces (menos a atual), com o workspace no detalhe', () => {
    const items = buildItems({ state: state(), query: '', openUrl: null });
    const tabs = items.filter((i) => i.group === 'Abas');
    expect(tabs.map((t) => [t.title, t.detail])).toEqual([['Teams', 'Trabalho · teams.microsoft.com/']]);
    expect(tabs[0].action).toEqual({ kind: 'command', command: { type: 'tab:reveal', tabId: 't' } });
  });

  it('ir para outro workspace; ações da aba atual', () => {
    const titles = buildItems({ state: state(), query: '', openUrl: null }).map((i) => i.title);
    expect(titles).toContain('Ir para o workspace Trabalho');
    expect(titles).not.toContain('Ir para o workspace Pessoal');
    expect(titles).toEqual(expect.arrayContaining(['Nova aba', 'Fixar esta aba', 'Fechar esta aba', 'Configurações', 'Bitwarden: conectar']));
  });

  it('busca acha a aba de outro workspace', () => {
    const items = buildItems({ state: state(), query: 'teams', openUrl: 'https://www.google.com/search?q=teams' });
    expect(items[0].title).toBe('Teams');
  });

  it('endereço digitado: "Abrir" no topo quando nada casa bem', () => {
    const items = buildItems({ state: state(), query: 'g1.globo.com', openUrl: 'https://g1.globo.com' });
    expect(items[0]).toMatchObject({ group: 'Abrir', action: { kind: 'command', command: { type: 'tab:new', url: 'https://g1.globo.com' } } });
  });

  it('painéis: abrir/fechar pela paleta', () => {
    const panels = [{ id: 'p1', workspaceId: 'w2', url: 'https://web.whatsapp.com/', title: 'WhatsApp', favicon: null, width: 420, mobile: false, loaded: false, hibernateMin: null }];
    const items = buildItems({ state: state({ panels, activePanelId: null }), query: 'whats', openUrl: null });
    expect(items[0]).toMatchObject({ title: 'Painel: WhatsApp', detail: 'Trabalho', action: { kind: 'command', command: { type: 'panel:toggle', panelId: 'p1' } } });
    expect(buildItems({ state: state({ panels, activePanelId: 'p1' }), query: 'whats', openUrl: null })[0].title).toBe('Fechar o painel: WhatsApp');
  });

  it('cofre desbloqueado com login no site: preencher e bloquear', () => {
    const items = buildItems({ state: state({ vault: { status: 'unlocked' } as UiState['vault'], vaultSite: { status: 'unlocked', count: 1 } }), query: '', openUrl: null });
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining(['Bitwarden: preencher login', 'Bitwarden: bloquear o cofre']));
  });
});

describe('favoritos na paleta', () => {
  const bookmarks = [{ id: 'b1', title: 'Moodle UFMG', url: 'https://moodle.ufmg.br/', favicon: null }];

  it('favoritos do workspace abrem pelo comando bookmark:open', () => {
    const items = buildItems({ state: state({ bookmarks, activeBookmarkId: null }), query: 'moodle', openUrl: 'https://www.google.com/search?q=moodle' });
    expect(items[0]).toMatchObject({ group: 'Favoritos', title: 'Moodle UFMG', detail: 'moodle.ufmg.br/',
      action: { kind: 'command', command: { type: 'bookmark:open', bookmarkId: 'b1' } } });
  });

  it('ação de marcar/editar a página atual (não na página inicial)', () => {
    const add = buildItems({ state: state({ bookmarks: [], activeBookmarkId: null }), query: '', openUrl: null });
    expect(add.find((i) => i.id === 'act:bookmark')?.title).toBe('Adicionar esta página aos favoritos');
    const edit = buildItems({ state: state({ bookmarks, activeBookmarkId: 'b1' }), query: '', openUrl: null });
    expect(edit.find((i) => i.id === 'act:bookmark')?.title).toBe('Editar o favorito desta página');
    const home = buildItems({ state: state({ tabs: [tab('a', 'Nova aba', { url: 'apollo://home/' })], bookmarks: [], activeBookmarkId: null }), query: '', openUrl: null });
    expect(home.find((i) => i.id === 'act:bookmark')).toBeUndefined();
  });
});

describe('histórico na paleta', () => {
  const paletteHistory = [
    { url: 'https://moodle.ufmg.br/course/1', title: 'Cálculo I' },
    { url: 'https://a.com/', title: 'Já aberta' },
    { url: 'https://fav.com/', title: 'Já favorito' },
  ];
  const bookmarks = [{ id: 'b', title: 'Fav', url: 'https://fav.com/', favicon: null }];

  it('sem repetir abas abertas e favoritos; abre em nova aba', () => {
    const items = buildItems({ state: state({ paletteHistory, bookmarks, activeBookmarkId: null }), query: 'calc', openUrl: null });
    const hist = items.filter((i) => i.group === 'Histórico');
    expect(hist.map((h) => h.title)).toEqual(['Cálculo I']);
    expect(hist[0]).toMatchObject({ detail: 'moodle.ufmg.br/course/1',
      action: { kind: 'command', command: { type: 'tab:new', url: 'https://moodle.ufmg.br/course/1' } } });
  });

  // Regressão: "diferencial calculo" não casava "Cálculo Diferencial" (busca aproximada
  // exige as letras em ordem) e o item do histórico, já filtrado por palavras, sumia.
  it('palavras fora de ordem: o item do histórico não é descartado', () => {
    const items = buildItems({ state: state({ paletteHistory, bookmarks: [], activeBookmarkId: null }), query: '1 calculo', openUrl: null });
    expect(items.filter((i) => i.group === 'Histórico').map((i) => i.title)).toContain('Cálculo I');
  });

  it('na página inicial (sem página): abre na própria aba', () => {
    const s = state({ tabs: [tab('a', 'Nova aba', { url: 'apollo://home', live: false })], paletteHistory, bookmarks: [], activeBookmarkId: null });
    const h = buildItems({ state: s, query: 'calc', openUrl: null }).find((i) => i.group === 'Histórico')!;
    expect(h.action).toEqual({ kind: 'command', command: { type: 'tab:navigate', url: 'https://moodle.ufmg.br/course/1' } });
  });
});
