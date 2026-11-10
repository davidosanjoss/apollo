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

export class PermissionManager {
  private queue: Pending[] = [];

  constructor(
    private readonly store: Store,
    private readonly resolveTab: (wc: WebContents | null) => string | null,
    private readonly onChange: () => void,
  ) {}

  attach(ses: Session, workspaceId: string): void {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (ALWAYS_ALLOW.has(permission)) return callback(true);

      const kinds = kindsFor(permission, (details as { mediaTypes?: string[] }).mediaTypes);
      const origin = originOf(details.requestingUrl);
      if (!kinds || kinds.length === 0 || !origin) return callback(false);

      const decisions = kinds.map((k) => this.store.getPermission(workspaceId, origin, k));
      if (decisions.includes('deny')) return callback(false);
      if (decisions.every((d) => d === 'allow')) return callback(true);

      // Sem decisão salva: pergunta. Só dá para perguntar se vier de uma aba (não de popup).
      const tabId = this.resolveTab(wc);
      if (!tabId) return callback(false);
      this.queue.push({ id: newId(), tabId, origin, kinds, workspaceId, resolve: callback });
      this.onChange();
    });

    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      if (ALWAYS_ALLOW.has(permission)) return true;
      const mediaType = (details as { mediaType?: string }).mediaType;
      const kinds = kindsFor(permission, mediaType && mediaType !== 'unknown' ? [mediaType] : undefined);
      const origin = originOf(requestingOrigin) ?? originOf(wc?.getURL());
      if (!kinds || !origin) return false;
      // Consulta síncrona: só "sim" se já foi permitido explicitamente.
      return kinds.every((k) => this.store.getPermission(workspaceId, origin, k) === 'allow');
    });
  }

  /** Pedido pendente a mostrar para a aba ativa (um de cada vez). */
  promptFor(tabId: string | null): PermissionPrompt | null {
    const p = this.queue.find((q) => q.tabId === tabId);
    return p ? { id: p.id, tabId: p.tabId, origin: p.origin, kinds: p.kinds } : null;
  }

  answer(promptId: string, decision: PermissionDecision, remember: boolean): void {
    const p = this.queue.find((q) => q.id === promptId);
    if (!p) return;
    this.queue = this.queue.filter((q) => q !== p);
    if (remember) for (const k of p.kinds) this.store.setPermission(p.workspaceId, p.origin, k, decision);
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
    this.onChange();
  }
}
