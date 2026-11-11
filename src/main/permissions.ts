import type { Session, WebContents } from 'electron';
import type { Store } from './store';
import { newId } from './store';
import type { PermissionDecision, PermissionKind, PermissionPrompt, SitePermissions } from '../shared/types';

/**
 * Permissões negadas por padrão. O Electron, sem isso, concede TUDO a qualquer site.
 *
 * - Inofensivas (tela cheia, escrever na área de transferência, DRM): liberadas.
 * - Sensíveis (câmera, microfone, localização, notificações…): perguntam ao usuário,
 *   e a decisão fica salva por workspace + origem.
 * - Todo o resto: negado.
 */

const ALWAYS_ALLOW = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'mediaKeySystem', // Widevine/DRM
  'speaker-selection',
  // Compartilhar tela: o consentimento é o seletor do Apollo (setDisplayMediaRequestHandler),
  // que sempre pergunta o que compartilhar; aqui só deixa o pedido chegar até ele.
  'display-capture',
]);

/** Permissões que o usuário pode ajustar no painel do site. */
export const SITE_PANEL_KINDS: PermissionKind[] = [
  'notifications', 'media-video', 'media-audio', 'geolocation', 'clipboard-read', 'open-external',
];

function kindsFor(permission: string, mediaTypes?: string[]): PermissionKind[] | null {
  switch (permission) {
    case 'media': {
      const kinds: PermissionKind[] = [];
      if (!mediaTypes || mediaTypes.length === 0 || mediaTypes.includes('video')) kinds.push('media-video');
      if (!mediaTypes || mediaTypes.length === 0 || mediaTypes.includes('audio')) kinds.push('media-audio');
      return kinds;
    }
    case 'geolocation': return ['geolocation'];
    case 'notifications': return ['notifications'];
    case 'clipboard-read': return ['clipboard-read'];
    case 'midi':
    case 'midiSysex': return ['midi'];
    case 'openExternal': return ['open-external'];
    case 'storage-access':
    case 'top-level-storage-access': return ['storage-access'];
    default: return null; // display-capture, idle-detection, window-management, fileSystem, unknown… → negado
  }
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

interface Pending extends PermissionPrompt {
  workspaceId: string;
  resolve: (granted: boolean) => void;
}

export type NotificationState = 'ask' | 'allow' | 'deny';

export class PermissionManager {
  private queue: Pending[] = [];
  /** "Permitir" sem "Lembrar": vale até fechar o Apollo (workspace|origem|tipo). */
  private readonly sessionGrants = new Set<string>();
  private static key = (ws: string, origin: string, kind: PermissionKind) => `${ws}|${origin}|${kind}`;

  private allowed(ws: string, origin: string, kind: PermissionKind): boolean {
    return this.store.getPermission(ws, origin, kind) === 'allow' || this.sessionGrants.has(PermissionManager.key(ws, origin, kind));
  }

  /** O que o site deve enxergar em Notification.permission ('ask' = ainda não decidido). */
  notificationState(workspaceId: string, origin: string): NotificationState {
    const d = this.store.getPermission(workspaceId, origin, 'notifications');
    if (d === 'deny') return 'deny';
    return this.allowed(workspaceId, origin, 'notifications') ? 'allow' : 'ask';
  }

  constructor(
    private readonly store: Store,
    private readonly resolveTab: (wc: WebContents | null) => string | null,
    private readonly onChange: () => void,
    /** Painéis laterais também pedem (WhatsApp/Teams no painel: câmera, microfone…). */
    private readonly resolvePanel: (wc: WebContents | null) => string | null = () => null,
  ) {}

  attach(ses: Session, workspaceId: string): void {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (ALWAYS_ALLOW.has(permission)) return callback(true);

      const kinds = kindsFor(permission, (details as { mediaTypes?: string[] }).mediaTypes);
      const origin = originOf(details.requestingUrl);
      if (!kinds || kinds.length === 0 || !origin) return callback(false);

      const decisions = kinds.map((k) => this.store.getPermission(workspaceId, origin, k));
      if (decisions.includes('deny')) return callback(false);
      if (kinds.every((k) => this.allowed(workspaceId, origin, k))) return callback(true);

      // Sem decisão salva: pergunta. Só dá para perguntar se vier de uma aba ou painel (não de popup).
      const tabId = this.resolveTab(wc);
      const panelId = tabId ? null : this.resolvePanel(wc);
      if (!tabId && !panelId) return callback(false);
      this.queue.push({ id: newId(), tabId, panelId, origin, kinds, workspaceId, resolve: callback });
      this.onChange();
    });

    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (ALWAYS_ALLOW.has(permission)) return true;
      const mediaType = (details as { mediaType?: string }).mediaType;
      const kinds = kindsFor(permission, mediaType && mediaType !== 'unknown' ? [mediaType] : undefined);
      const origin = originOf(requestingOrigin) ?? originOf(wc?.getURL());
      if (!kinds || !origin) return false;
      // Consulta síncrona: só "sim" se já foi permitido (salvo, ou nesta execução).
      return kinds.every((k) => this.allowed(workspaceId, origin, k));
    });
  }

  /** Pedido pendente a mostrar: o da aba ativa, senão o do painel aberto (um de cada vez). */
  promptFor(tabId: string | null, panelId: string | null = null): PermissionPrompt | null {
    const p = (tabId ? this.queue.find((q) => q.tabId === tabId) : undefined)
      ?? (panelId ? this.queue.find((q) => q.panelId === panelId) : undefined);
    return p ? { id: p.id, tabId: p.tabId, panelId: p.panelId, origin: p.origin, kinds: p.kinds } : null;
  }

  /** Painel fechado ou removido: pedidos pendentes dele são negados. */
  cancelForPanel(panelId: string): void {
    const dropped = this.queue.filter((q) => q.panelId === panelId);
    if (dropped.length === 0) return;
    this.queue = this.queue.filter((q) => q.panelId !== panelId);
    for (const p of dropped) p.resolve(false);
    this.onChange();
  }

  answer(promptId: string, decision: PermissionDecision, remember: boolean): void {
    const p = this.queue.find((q) => q.id === promptId);
    if (!p) return;
    this.queue = this.queue.filter((q) => q !== p);
    if (remember) for (const k of p.kinds) this.store.setPermission(p.workspaceId, p.origin, k, decision);
    // Regressão: sem "Lembrar", o pedido era liberado mas a checagem seguinte dizia "não"
    // (ex.: new Notification() falhava logo depois de permitir).
    else if (decision === 'allow') for (const k of p.kinds) this.sessionGrants.add(PermissionManager.key(p.workspaceId, p.origin, k));
    p.resolve(decision === 'allow');
    this.onChange();
  }

  /** Aba fechada ou navegou: pedidos pendentes dela são negados. */
  cancelForTab(tabId: string): void {
    const dropped = this.queue.filter((q) => q.tabId === tabId);
    if (dropped.length === 0) return;
    this.queue = this.queue.filter((q) => q.tabId !== tabId);
    for (const p of dropped) p.resolve(false);
    this.onChange();
  }

  siteInfo(workspaceId: string, url: string | null): SitePermissions | null {
    const origin = originOf(url);
    if (!origin || !/^https?:/.test(origin)) return null;
    return {
      origin,
      entries: SITE_PANEL_KINDS.map((kind) => ({ kind, decision: this.store.getPermission(workspaceId, origin, kind) })),
    };
  }

  set(workspaceId: string, origin: string, kind: PermissionKind, decision: PermissionDecision | null): void {
    this.store.setPermission(workspaceId, origin, kind, decision);
    this.sessionGrants.delete(PermissionManager.key(workspaceId, origin, kind)); // a escolha explícita vale
    this.onChange();
  }
}
