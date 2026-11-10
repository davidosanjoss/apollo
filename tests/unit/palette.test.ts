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
  canGoBack: false, canGoForward: false, dormant: false, pinned: false, keepAwake: false, groupId: null, ...over });
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
    const panels = [{ id: 'p1', workspaceId: 'w2', url: 'https://web.whatsapp.com/', title: 'WhatsApp', favicon: null, width: 420, mobile: false, loaded: false }];
    const items = buildItems({ state: state({ panels, activePanelId: null }), query: 'whats', openUrl: null });
    expect(items[0]).toMatchObject({ title: 'Painel: WhatsApp', detail: 'Trabalho', action: { kind: 'command', command: { type: 'panel:toggle', panelId: 'p1' } } });
    expect(buildItems({ state: state({ panels, activePanelId: 'p1' }), query: 'whats', openUrl: null })[0].title).toBe('Fechar o painel: WhatsApp');
  });

  it('cofre desbloqueado com login no site: preencher e bloquear', () => {
    const items = buildItems({ state: state({ vault: { status: 'unlocked' } as UiState['vault'], vaultSite: { status: 'unlocked', count: 1 } }), query: '', openUrl: null });
    expect(items.map((i) => i.title)).toEqual(expect.arrayContaining(['Bitwarden: preencher login', 'Bitwarden: bloquear o cofre']));
  });
});
