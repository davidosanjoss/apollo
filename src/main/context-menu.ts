// Menu de contexto das páginas (botão direito): decide os itens a partir do que foi
// clicado. Puro (sem Electron), para ser testável; o Browser executa as ações.
import { SEARCH_URL } from '../shared/url';

/** O subconjunto de Electron.ContextMenuParams que o menu usa. */
export interface ContextInfo {
  linkURL: string;
  linkText: string;
  srcURL: string;
  mediaType: 'none' | 'image' | 'audio' | 'video' | 'canvas' | 'file' | 'plugin';
  selectionText: string;
  isEditable: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
  /** Campo de senha (para o Bitwarden). */
  formControlType?: string;
}

export interface ContextState {
  canGoBack: boolean;
  canGoForward: boolean;
  /** Cofre do Bitwarden desbloqueado. */
  vaultUnlocked: boolean;
}

export type ContextAction =
  | { kind: 'open-link'; url: string; background: boolean }
  | { kind: 'copy-text'; text: string }
  | { kind: 'copy-image' }
  | { kind: 'save-url'; url: string }
  | { kind: 'search'; url: string }
  | { kind: 'replace-misspelling'; word: string }
  | { kind: 'add-to-dictionary'; word: string }
  | { kind: 'edit'; op: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll' }
  | { kind: 'nav'; op: 'back' | 'forward' | 'reload' }
  | { kind: 'view-source' }
  | { kind: 'print' }
  | { kind: 'pip' }
  | { kind: 'inspect' }
  | { kind: 'vault'; op: 'autofill' | 'generate' };

export type ContextItem =
  | { type: 'item'; label: string; action: ContextAction; enabled?: boolean }
  | { type: 'separator' };

const NAVIGABLE = /^(https?|file|data|blob):/i;
const SHORT = 32;
/** Rótulo curto da seleção: "Pesquisar no Google por “…”". */
export const shorten = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SHORT ? `${t.slice(0, SHORT - 1)}…` : t;
};

export function buildContextMenu(p: ContextInfo, s: ContextState): ContextItem[] {
  const groups: ContextItem[][] = [];
  const item = (label: string, action: ContextAction, enabled = true): ContextItem => ({ type: 'item', label, action, enabled });

  // Corretor: sugestões primeiro (como no Chrome).
  if (p.isEditable && p.misspelledWord) {
    const g = p.dictionarySuggestions.slice(0, 5).map((w) => item(w, { kind: 'replace-misspelling', word: w }));
    if (!g.length) g.push(item('Sem sugestões', { kind: 'replace-misspelling', word: p.misspelledWord }, false));
    g.push(item(`Adicionar “${shorten(p.misspelledWord)}” ao dicionário`, { kind: 'add-to-dictionary', word: p.misspelledWord }));
    groups.push(g);
  }

  if (p.linkURL && NAVIGABLE.test(p.linkURL)) {
    groups.push([
      item('Abrir link em nova aba', { kind: 'open-link', url: p.linkURL, background: false }),
      item('Abrir link em segundo plano', { kind: 'open-link', url: p.linkURL, background: true }),
      item('Copiar endereço do link', { kind: 'copy-text', text: p.linkURL }),
      ...(p.linkText.trim() && !p.selectionText ? [item('Copiar texto do link', { kind: 'copy-text', text: p.linkText.trim() })] : []),
      item('Salvar link como…', { kind: 'save-url', url: p.linkURL }),
    ]);
  }

  if (p.mediaType === 'image' && p.srcURL) {
    groups.push([
      item('Abrir imagem em nova aba', { kind: 'open-link', url: p.srcURL, background: false }),
      item('Copiar imagem', { kind: 'copy-image' }),
      item('Copiar endereço da imagem', { kind: 'copy-text', text: p.srcURL }),
      item('Salvar imagem como…', { kind: 'save-url', url: p.srcURL }),
    ]);
  } else if (p.mediaType === 'video') {
    // Vídeo flutuante vale até para streaming (blob:), como YouTube e Netflix.
    groups.push([item('Vídeo flutuante (picture-in-picture)', { kind: 'pip' })]);
  }
  if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && NAVIGABLE.test(p.srcURL) && !p.srcURL.startsWith('blob:')) {
    const what = p.mediaType === 'video' ? 'vídeo' : 'áudio';
    groups.push([
      item(`Abrir ${what} em nova aba`, { kind: 'open-link', url: p.srcURL, background: false }),
      item(`Copiar endereço do ${what}`, { kind: 'copy-text', text: p.srcURL }),
      item(`Salvar ${what} como…`, { kind: 'save-url', url: p.srcURL }),
    ]);
  }

  if (p.isEditable) {
    const f = p.editFlags;
    groups.push([
      item('Desfazer', { kind: 'edit', op: 'undo' }, f.canUndo),
      item('Refazer', { kind: 'edit', op: 'redo' }, f.canRedo),
    ], [
      item('Recortar', { kind: 'edit', op: 'cut' }, f.canCut),
      item('Copiar', { kind: 'edit', op: 'copy' }, f.canCopy),
      item('Colar', { kind: 'edit', op: 'paste' }, f.canPaste),
      item('Colar sem formatação', { kind: 'edit', op: 'pasteAndMatchStyle' }, f.canPaste),
      item('Selecionar tudo', { kind: 'edit', op: 'selectAll' }, f.canSelectAll),
    ]);
    if (s.vaultUnlocked) {
      groups.push([
        item('Bitwarden: preencher login', { kind: 'vault', op: 'autofill' }),
        ...(p.formControlType === 'input-password' ? [item('Bitwarden: gerar senha aqui', { kind: 'vault', op: 'generate' })] : []),
      ]);
    }
  } else if (p.selectionText.trim()) {
    groups.push([item('Copiar', { kind: 'edit', op: 'copy' })]);
  }

  if (p.selectionText.trim()) {
    const text = p.selectionText.trim();
    groups.push([item(`Pesquisar no Google por “${shorten(text)}”`, { kind: 'search', url: SEARCH_URL + encodeURIComponent(text) })]);
  }

  // Clique na página em si (nada específico): navegação.
  if (!groups.length) {
    groups.push([
      item('Voltar', { kind: 'nav', op: 'back' }, s.canGoBack),
      item('Avançar', { kind: 'nav', op: 'forward' }, s.canGoForward),
      item('Recarregar', { kind: 'nav', op: 'reload' }),
    ], [
      item('Imprimir…', { kind: 'print' }),
      item('Ver código-fonte', { kind: 'view-source' }),
    ]);
  }

  groups.push([item('Inspecionar', { kind: 'inspect' })]);
  return groups.flatMap((g, i) => (i ? [{ type: 'separator' } as ContextItem, ...g] : g));
}
