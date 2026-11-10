// Verificação de versões nas Releases públicas: avisa de versão nova (com as notas) e,
// depois de atualizar, mostra as novidades uma vez. Vale para qualquer instalação
// (AppImage/Windows instalam sozinhos; tar.gz/pacotes recebem o link de download).
// A consulta não leva nada do usuário: só o endereço público da API do GitHub.
import { net, shell } from 'electron';
import type { UpdateAbout, UpdateNotice } from '../shared/types';
import { compareVersions, parseNotes } from '../shared/release-notes';
import type { Store } from './store';

export const RELEASES_API = 'https://api.github.com/repos/davidosanjoss/apollo-releases';
const RELEASES_PAGE = 'https://github.com/davidosanjoss/apollo-releases/releases/';
const FIRST_CHECK_DELAY = 15_000;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

interface Release { tag_name: string; body: string | null; html_url: string; draft?: boolean; prerelease?: boolean }

export class UpdateCheck {
  private notice: UpdateNotice | null = null;
  private latest: string | null = null;
  private checking = false;
  private checked: number | null = null;
  private failed = false;
  /** "Depois": não insiste nesta execução. */
  private dismissed = new Set<string>();

  constructor(private readonly opts: {
    current: string;
    store: Store;
    /** null = sem verificação (desenvolvimento). */
    api: string | null;
    /** Esta instalação se atualiza sozinha (AppImage, Windows). */
    canInstall: boolean;
    onChange: () => void;
  }) {}

  start(): void {
    if (!this.opts.api) return;
    void this.whatsNew();
    const delay = Number(process.env.APOLLO_TEST_UPDATE_DELAY_MS) || FIRST_CHECK_DELAY;
    setTimeout(() => void this.check(false), delay).unref();
    setInterval(() => void this.check(false), CHECK_INTERVAL).unref();
  }

  about(): UpdateAbout {
    return { version: this.opts.current, latest: this.latest, checking: this.checking, checked: this.checked,
      failed: this.failed, enabled: this.opts.api !== null };
  }

  current(): UpdateNotice | null {
    return this.notice;
  }

  private async fetchRelease(path: string): Promise<Release | null> {
    const res = await net.fetch(`${this.opts.api}${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Apollo' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json() as Release;
    return typeof r?.tag_name === 'string' ? r : null;
  }

  /** Página da release: só a do repositório oficial (ou a da API de teste). */
  private safeUrl(url: unknown, version: string): string {
    const fallback = `${RELEASES_PAGE}tag/v${version}`;
    if (typeof url !== 'string') return fallback;
    const okPrefix = this.opts.api === RELEASES_API ? RELEASES_PAGE : new URL(this.opts.api!).origin + '/';
    return url.startsWith(okPrefix) ? url : fallback;
  }

  /** manual = botão "Verificar agora": mostra mesmo se a versão foi pulada. */
  async check(manual: boolean): Promise<void> {
    if (!this.opts.api || this.checking) return;
    this.checking = true;
    this.opts.onChange();
    try {
      const r = await this.fetchRelease('/releases/latest');
      this.failed = false;
      this.checked = Date.now();
      if (!r || r.draft || r.prerelease) return;
      const version = r.tag_name.replace(/^v/i, '');
      this.latest = version;
      if (compareVersions(version, this.opts.current) <= 0) return;
      const skipped = this.opts.store.getKv('update-skip') === version;
      if (!manual && (skipped || this.dismissed.has(version))) return;
      this.notice = { kind: 'available', version, notes: parseNotes(r.body ?? ''), url: this.safeUrl(r.html_url, version),
        canInstall: this.opts.canInstall };
    } catch (err) {
      this.failed = true;
      console.warn('[apollo] verificação de versão falhou:', (err as Error).message);
    } finally {
      this.checking = false;
      this.opts.onChange();
    }
  }

  /** Primeira abertura depois de atualizar: as novidades desta versão, uma vez. */
  private async whatsNew(): Promise<void> {
    const { store, current } = this.opts;
    const last = store.getKv('last-version');
    store.setKv('last-version', current);
    if (!last || compareVersions(current, last) <= 0) return; // instalação nova ou a mesma versão
    try {
      const r = await this.fetchRelease(`/releases/tags/v${current}`);
      if (!r || this.notice?.kind === 'available') return;
      this.notice = { kind: 'whats-new', version: current, notes: parseNotes(r.body ?? ''), url: this.safeUrl(r.html_url, current), canInstall: false };
      this.opts.onChange();
    } catch {
      // sem rede: tudo bem, as novidades também estão no CHANGELOG
    }
  }

  dismiss(): void {
    if (this.notice?.kind === 'available') this.dismissed.add(this.notice.version);
    this.notice = null;
    this.opts.onChange();
  }

  skip(): void {
    if (this.notice?.kind === 'available') this.opts.store.setKv('update-skip', this.notice.version);
    this.notice = null;
    this.opts.onChange();
  }

  openPage(): void {
    if (this.notice) void shell.openExternal(this.notice.url);
  }
}
