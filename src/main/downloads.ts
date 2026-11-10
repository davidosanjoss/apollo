// Downloads de todas as sessões (workspaces): salva na pasta Downloads com nome único
// (ou pergunta onde salvar) e mantém a lista com o progresso para a interface.
import fs from 'node:fs';
import path from 'node:path';
import { shell, type DownloadItem, type Session, type WebContents } from 'electron';
import type { DownloadAction, DownloadInfo } from '../shared/types';
import { uniqueName } from './download-names';
import { newId } from './store';

const MAX_LISTED = 30;
const PUSH_EVERY_MS = 400;

interface Entry { info: DownloadInfo; item: DownloadItem; path: string }

export class DownloadManager {
  private entries: Entry[] = []; // mais recente primeiro
  private readonly askNext = new Set<string>();
  private readonly sessions = new WeakSet<Session>();
  private pushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: { dir: () => string; ask: () => boolean; onChange: () => void }) {}

  attach(ses: Session): void {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.on('will-download', (_e, item) => this.start(item));
  }

  /** "Salvar … como…": este download sempre pergunta onde salvar. */
  saveAs(wc: WebContents, url: string): void {
    this.askNext.add(url);
    wc.downloadURL(url);
  }

  list(): DownloadInfo[] {
    return this.entries.map((e) => ({ ...e.info }));
  }

  private start(item: DownloadItem): void {
    const url = item.getURL();
    const dir = this.opts.dir();
    if (this.askNext.delete(url) || this.opts.ask()) {
      item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) }); // sem setSavePath: o sistema pergunta
    } else {
      // Nomes reservados pelos downloads ainda em andamento (o arquivo pode não existir ainda).
      const busy = new Set(this.entries.filter((e) => e.info.state === 'progressing' || e.info.state === 'paused').map((e) => e.path));
      const name = uniqueName(item.getFilename(), (n) => busy.has(path.join(dir, n)) || fs.existsSync(path.join(dir, n)));
      item.setSavePath(path.join(dir, name));
    }
    const entry: Entry = {
      item,
      path: item.getSavePath(),
      info: { id: newId(), filename: path.basename(item.getSavePath()) || item.getFilename(), url, state: 'progressing',
        received: 0, total: item.getTotalBytes() },
    };
    this.entries.unshift(entry);
    this.prune();

    item.on('updated', (_e, state) => {
      entry.path = item.getSavePath() || entry.path; // escolhido no diálogo
      if (entry.path) entry.info.filename = path.basename(entry.path);
      entry.info.received = item.getReceivedBytes();
      entry.info.total = item.getTotalBytes();
      entry.info.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      this.schedulePush();
    });
    item.once('done', (_e, state) => {
      entry.path = item.getSavePath() || entry.path;
      // Cancelado no diálogo "salvar como" (nunca começou): some da lista.
      if (state === 'cancelled' && !entry.path) {
        this.entries = this.entries.filter((e) => e !== entry);
      } else {
        entry.info.state = state;
        entry.info.received = item.getReceivedBytes();
        entry.info.total = item.getTotalBytes() || entry.info.received;
        if (entry.path) entry.info.filename = path.basename(entry.path);
      }
      this.pushNow();
    });
    this.pushNow();
  }

  action(id: string, action: DownloadAction): void {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e) return;
    const running = e.info.state === 'progressing' || e.info.state === 'paused';
    switch (action) {
      case 'pause': if (e.info.state === 'progressing') { e.item.pause(); e.info.state = 'paused'; } break;
      case 'resume': if (e.item.canResume()) { e.item.resume(); e.info.state = 'progressing'; } break;
      case 'cancel': if (running) e.item.cancel(); break;
      case 'open': if (e.info.state === 'completed') void shell.openPath(e.path); break;
      case 'show': if (e.path) shell.showItemInFolder(e.path); break;
      case 'remove': if (!running) this.entries = this.entries.filter((x) => x !== e); break;
    }
    this.pushNow();
  }

  /** Tira da lista o que já terminou (concluído, cancelado, falhou). */
  clear(): void {
    this.entries = this.entries.filter((e) => e.info.state === 'progressing' || e.info.state === 'paused');
    this.pushNow();
  }

  private prune(): void {
    const keep: Entry[] = [];
    for (const e of this.entries) {
      const running = e.info.state === 'progressing' || e.info.state === 'paused';
      if (running || keep.length < MAX_LISTED) keep.push(e);
    }
    this.entries = keep;
  }

  private schedulePush(): void {
    this.pushTimer ??= setTimeout(() => this.pushNow(), PUSH_EVERY_MS);
  }

  private pushNow(): void {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    this.opts.onChange();
  }
}
