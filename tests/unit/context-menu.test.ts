import { describe, expect, it } from 'vitest';
import { buildContextMenu, shorten, type ContextInfo, type ContextItem } from '../../src/main/context-menu';

const flags = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true };
const info = (over: Partial<ContextInfo> = {}): ContextInfo => ({
  linkURL: '', linkText: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false,
  misspelledWord: '', dictionarySuggestions: [], editFlags: flags, ...over,
});
const st = { canGoBack: true, canGoForward: false, vaultUnlocked: false };
const labels = (items: ContextItem[]) => items.map((i) => (i.type === 'separator' ? '—' : i.label));
const find = (items: ContextItem[], label: string) => items.find((i) => i.type === 'item' && i.label === label) as Extract<ContextItem, { type: 'item' }>;

describe('menu de contexto', () => {
  it('página: navegação (avançar desabilitado quando não dá), código-fonte, inspecionar', () => {
    const m = buildContextMenu(info(), st);
    expect(labels(m)).toEqual(['Voltar', 'Avançar', 'Recarregar', '—', 'Imprimir…', 'Ver código-fonte', '—', 'Inspecionar']);
    expect(find(m, 'Avançar').enabled).toBe(false);
  });

  it('link: abrir (frente/fundo), copiar endereço e texto, salvar', () => {
    const m = buildContextMenu(info({ linkURL: 'https://a.com/x', linkText: ' Ir ' }), st);
    expect(labels(m)).toEqual(['Abrir link em nova aba', 'Abrir link em segundo plano', 'Copiar endereço do link',
      'Copiar texto do link', 'Salvar link como…', '—', 'Inspecionar']);
    expect(find(m, 'Abrir link em segundo plano').action).toEqual({ kind: 'open-link', url: 'https://a.com/x', background: true });
    expect(find(m, 'Copiar texto do link').action).toEqual({ kind: 'copy-text', text: 'Ir' });
  });

  it('link javascript: não ganha "abrir"', () => {
    expect(labels(buildContextMenu(info({ linkURL: 'javascript:void(0)' }), st))).toContain('Voltar');
  });

  it('imagem: abrir, copiar imagem/endereço, salvar', () => {
    const m = buildContextMenu(info({ mediaType: 'image', srcURL: 'https://a.com/i.png' }), st);
    expect(labels(m).slice(0, 4)).toEqual(['Abrir imagem em nova aba', 'Copiar imagem', 'Copiar endereço da imagem', 'Salvar imagem como…']);
  });

  it('vídeo blob: (streaming) não oferece abrir/salvar', () => {
    expect(labels(buildContextMenu(info({ mediaType: 'video', srcURL: 'blob:https://a.com/1' }), st))).not.toContain('Abrir vídeo em nova aba');
  });

  it('seleção: copiar e pesquisar (rótulo encurtado, URL com o texto inteiro)', () => {
    const long = 'a '.repeat(40).trim();
    const m = buildContextMenu(info({ selectionText: long }), st);
    expect(labels(m)[0]).toBe('Copiar');
    const search = m.find((i) => i.type === 'item' && i.label.startsWith('Pesquisar')) as Extract<ContextItem, { type: 'item' }>;
    expect(search.label).toBe(`Pesquisar no Google por “${shorten(long)}”`);
    expect(shorten(long).length).toBe(32);
    expect(search.action).toEqual({ kind: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(long)}` });
  });

  it('campo com palavra errada: sugestões primeiro, dicionário, edição conforme o que pode', () => {
    const m = buildContextMenu(info({ isEditable: true, misspelledWord: 'univercidade', dictionarySuggestions: ['universidade', 'a', 'b', 'c', 'd', 'e'] }), st);
    expect(labels(m).slice(0, 7)).toEqual(['universidade', 'a', 'b', 'c', 'd', 'Adicionar “univercidade” ao dicionário', '—']);
    expect(find(m, 'Colar').enabled).toBe(true);
    expect(find(m, 'Recortar').enabled).toBe(false);
    expect(labels(m)).not.toContain('Voltar');
  });

  it('palavra errada sem sugestões: item desabilitado', () => {
    const m = buildContextMenu(info({ isEditable: true, misspelledWord: 'xyzzyq' }), st);
    expect(find(m, 'Sem sugestões').enabled).toBe(false);
  });

  it('Bitwarden só com o cofre aberto; gerar senha só em campo de senha', () => {
    expect(labels(buildContextMenu(info({ isEditable: true }), st))).not.toContain('Bitwarden: preencher login');
    const open = { ...st, vaultUnlocked: true };
    expect(labels(buildContextMenu(info({ isEditable: true }), open))).toContain('Bitwarden: preencher login');
    expect(labels(buildContextMenu(info({ isEditable: true }), open))).not.toContain('Bitwarden: gerar senha aqui');
    expect(labels(buildContextMenu(info({ isEditable: true, formControlType: 'input-password' }), open))).toContain('Bitwarden: gerar senha aqui');
  });
});
