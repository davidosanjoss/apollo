// Downloads de todas as sessões (workspaces): salva na pasta Downloads com nome único
// (ou pergunta onde salvar) e mantém a lista com o progresso para a interface.
import fs from 'node:fs';
import path from 'node:path';
import { shell, type DownloadItem, type Session, type WebContents } from 'electron';
import type { DownloadAction, DownloadInfo } from '../shared/types';
import { uniqueName } from './download-names';
import { newId, type SavedDownload } from './store';

/** Onde a lista fica guardada (o Store, nos testes um falso). */
export interface DownloadPersistence {
  load(since: number): SavedDownload[];
  save(d: SavedDownload): void;
  remove(id: string): void;
  prune(before: number): void;
  /** Dias guardados (0 = só nesta sessão). */
  keepDays(): number;
}

const MAX_LISTED = 30;
const PUSH_EVERY_MS = 400;

/** item = null: download de uma sessão anterior (só abrir, mostrar ou tirar da lista). */
interface Entry { info: DownloadInfo; item: DownloadItem | null; path: string }

export class DownloadManager {
  private entries: Entry[] = []; // mais recente primeiro
  private readonly askNext = new Set<string>();
  private readonly sessions = new WeakSet<Session>();
  private pushTimer: NodeJS.Timeout | null = null;
  /** Já gravados com o caminho final (para não gravar a cada atualização de progresso). */
  private readonly saved = new Set<string>();

  constructor(private readonly opts: { dir: () => string; ask: () => boolean; onChange: () => void; persist?: DownloadPersistence }) {
    const p = opts.persist;
    if (!p) return;
    const days = p.keepDays();
    p.prune(days > 0 ? Date.now() - days * 86_400_000 : Infinity);
    // Os que ficaram pela metade quando o Apollo fechou não têm como continuar: "falhou".
    this.entries = p.load(days > 0 ? Date.now() - days * 86_400_000 : Infinity).slice(0, MAX_LISTED).map((d) => {
      const state = d.state === 'progressing' || d.state === 'paused' ? 'interrupted' : d.state;
      if (state !== d.state) p.save({ ...d, state });
      return { item: null, path: d.path, info: { id: d.id, filename: d.filename, url: d.url, state, received: d.received, total: d.total, startedAt: d.startedAt } };
    });
  }

  /** Mudou o período nas configurações: apaga do disco o que passou dele (a lista desta sessão fica). */
  applyKeepDays(): void {
    const p = this.opts.persist;
    if (!p) return;
    const days = p.keepDays();
    p.prune(days > 0 ? Date.now() - days * 86_400_000 : Infinity);
    if (days > 0) for (const e of this.entries) if (e.info.startedAt >= Date.now() - days * 86_400_000) this.persist(e);
  }

  private persist(e: Entry): void {
    if (this.opts.persist && this.opts.persist.keepDays() > 0) this.opts.persist.save({ ...e.info, path: e.path });
  }

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
        received: 0, total: item.getTotalBytes(), startedAt: Date.now() },
    };
    this.entries.unshift(entry);
    this.prune();

    item.on('updated', (_e, state) => {
      entry.path = item.getSavePath() || entry.path; // escolhido no diálogo
      if (entry.path) entry.info.filename = path.basename(entry.path);
      entry.info.received = item.getReceivedBytes();
      entry.info.total = item.getTotalBytes();
      const before = entry.info.state;
      entry.info.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing';
      if (before !== entry.info.state || (entry.path && !this.saved.has(entry.info.id))) { this.saved.add(entry.info.id); this.persist(entry); }
      this.schedulePush();
    });
    item.once('done', (_e, state) => {
      entry.path = item.getSavePath() || entry.path;
      // Cancelado no diálogo "salvar como" (nunca começou): some da lista.
      if (state === 'cancelled' && !entry.path) {
        this.entries = this.entries.filter((e) => e !== entry);
        this.opts.persist?.remove(entry.info.id);
      } else {
        entry.info.state = state;
        entry.info.received = item.getReceivedBytes();
        entry.info.total = item.getTotalBytes() || entry.info.received;
        if (entry.path) entry.info.filename = path.basename(entry.path);
        this.persist(entry);
      }
      this.pushNow();
    });
    this.pushNow();
  }

  action(id: string, action: DownloadAction): void {
    const e = this.entries.find((x) => x.info.id === id);
    if (!e) return;
    const running = e.item !== null && (e.info.state === 'progressing' || e.info.state === 'paused');
    const item = e.item;
    switch (action) {
      case 'pause': if (item && e.info.state === 'progressing') { item.pause(); e.info.state = 'paused'; this.persist(e); } break;
      case 'resume': if (item?.canResume()) { item.resume(); e.info.state = 'progressing'; this.persist(e); } break;
      case 'cancel': if (running) item!.cancel(); break;
      case 'open': if (e.info.state === 'completed') void shell.openPath(e.path); break;
      case 'show': if (e.path) shell.showItemInFolder(e.path); break;
      case 'remove':
        if (!running) { this.entries = this.entries.filter((x) => x !== e); this.opts.persist?.remove(e.info.id); }
        break;
    }
    this.pushNow();
  }

  /** Tira da lista o que já terminou (concluído, cancelado, falhou). */
  clear(): void {
    for (const e of this.entries) if (!(e.item && (e.info.state === 'progressing' || e.info.state === 'paused'))) this.opts.persist?.remove(e.info.id);
    this.entries = this.entries.filter((e) => e.item && (e.info.state === 'progressing' || e.info.state === 'paused'));
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
