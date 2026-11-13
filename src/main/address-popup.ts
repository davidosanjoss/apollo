// Lista de sugestões da barra de endereço. A página do site é nativa e fica POR CIMA do
// HTML da UI, então a lista não pode ser HTML da UI: é uma view própria, colocada acima de
// tudo logo abaixo da barra. Só desenha e avisa o clique; o foco continua na barra.
import path from 'node:path';
import { WebContentsView, type BrowserWindow, type IpcMainEvent } from 'electron';
import type { Suggestion } from '../shared/suggest';

export const SUGGEST_URL = 'apollo://suggest/index.html';
/** Altura de cada linha e margem da lista (iguais ao CSS de src/pages/suggest). */
export const ROW_HEIGHT = 34;
export const LIST_PADDING = 6;

export function popupHeight(count: number): number {
  return count > 0 ? count * ROW_HEIGHT + LIST_PADDING * 2 : 0;
}

export class AddressPopup {
  private view: WebContentsView | null = null;
  private ready: Promise<void> | null = null;
  private shown = false;

  constructor(private readonly win: BrowserWindow) {}

  /** O clique veio mesmo da lista (e não de uma página)? */
  isSender(event: IpcMainEvent): boolean {
    return Boolean(this.view) && event.sender === this.view!.webContents && event.senderFrame === this.view!.webContents.mainFrame
      && (event.senderFrame?.url ?? '').startsWith(SUGGEST_URL);
  }

  private ensure(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'suggest-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Regressão: ao carregar, a lista roubava o foco da barra, que fechava as sugestões
        // (a primeira busca não mostrava nada).
        focusOnNavigation: false,
      },
    });
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    const wc = view.webContents;
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.ready = wc.loadURL(SUGGEST_URL).catch(() => {});
    this.view = view;
    return view;
  }

  show(at: { x: number; y: number; width: number }, items: Suggestion[], selected: number): void {
    if (this.win.isDestroyed()) return;
    if (!items.length) return this.hide();
    const view = this.ensure();
    const [winW, winH] = this.win.getContentSize();
    const width = Math.max(200, Math.min(Math.round(at.width), winW - Math.round(at.x)));
    const height = Math.min(popupHeight(items.length), Math.max(0, winH - Math.round(at.y)));
    this.win.contentView.addChildView(view); // para o topo (acima da página e dos painéis)
    view.setBounds({ x: Math.round(at.x), y: Math.round(at.y), width, height });
    const data = { items: items.map(({ kind, url, title }) => ({ kind, url, title })), selected };
    void this.ready?.then(() => {
      if (view.webContents.isDestroyed()) return;
      view.webContents.send('suggest:items', data);
      view.setVisible(this.shown);
    });
    this.shown = true;
  }

  select(index: number): void {
    if (!this.shown || !this.view || this.view.webContents.isDestroyed()) return;
    this.view.webContents.send('suggest:select', index);
  }

  hide(): void {
    this.shown = false;
    if (this.view && !this.view.webContents.isDestroyed()) this.view.setVisible(false);
  }

  get visible(): boolean {
    return this.shown;
  }
}
