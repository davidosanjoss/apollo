import type { IpcMainEvent, WebContents } from 'electron';
import type { PermissionKind, UiCommand } from '../shared/types';
import { DOWNLOAD_KEEP_DAYS, GENERATOR_LENGTHS, GROUP_COLORS, HIDDEN_HIBERNATE_OPTIONS_MIN, PANEL_HIBERNATE_OPTIONS_MIN, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, HIBERNATE_OPTIONS_MIN, MEMORY_LIMIT_OPTIONS_MB, PERMISSION_LABELS, PRIVACY_LABELS } from '../shared/types';
import { UI_URL } from './protocol';
import { validDohUrl } from './settings';
import { LOCK_OPTIONS_MIN } from './vault/service';
import { validVaultServer } from './vault/api';
import { MODULES } from './modules';
import { SPELLCHECK_MODES } from './spellcheck';
import { MAX_CODE } from './customizations';
import { READER_SIZES } from '../reader/template';

/**
 * Toda mensagem da UI é validada: tem que vir do frame principal da janela do
 * navegador, carregado de apollo://ui, e ter o formato exato de um comando conhecido.
 */
export function isTrustedSender(event: IpcMainEvent, ui: WebContents): boolean {
  return event.sender === ui
    && event.senderFrame === ui.mainFrame
    && (event.senderFrame?.url ?? '').startsWith(UI_URL.replace('index.html', ''));
}

const str = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000;
const color = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const kind = (v: unknown): v is PermissionKind => typeof v === 'string' && Object.hasOwn(PERMISSION_LABELS, v);
const decision = (v: unknown) => v === 'allow' || v === 'deny';
const id = (v: unknown): v is string => str(v, 64) && (v as string).length > 0;
const groupColor = (v: unknown) => typeof v === 'string' && (GROUP_COLORS as readonly string[]).includes(v);
const hibernate = (v: unknown) => v === undefined || (HIBERNATE_OPTIONS_MIN as readonly unknown[]).includes(v);
const hiddenHibernate = (v: unknown) => v === undefined || (HIDDEN_HIBERNATE_OPTIONS_MIN as readonly unknown[]).includes(v);
/** Ícone do workspace: um emoji/símbolo curto (no máximo 2 "caracteres" visíveis), ou null. */
export const validIcon = (v: unknown) => v === undefined || v === null
  || (typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 16
    && [...new Intl.Segmenter('pt', { granularity: 'grapheme' }).segment(v)].length <= 2 && !/[<>&"'\s]/.test(v));
const password = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const url = (v: unknown): v is string => str(v, 8192) && /^(https?|apollo|file|about|data|view-source):/i.test(v as string);

export function parseCommand(raw: unknown): UiCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'tab:new': return c.url === undefined || url(c.url) ? (c as UiCommand) : null;
    case 'tab:close':
    case 'tab:activate': return str(c.tabId, 64) ? (c as UiCommand) : null;
    case 'tab:navigate': return url(c.url) ? (c as UiCommand) : null;
    case 'tab:reopen':
    case 'tab:back':
    case 'tab:forward':
    case 'tab:reload':
    case 'tab:focus':
    case 'update:download':
    case 'update:install': return { type: c.type } as UiCommand;
    case 'workspace:switch':
    case 'workspace:delete': return str(c.workspaceId, 64) ? (c as UiCommand) : null;
    case 'workspace:create':
      return str(c.name, 30) && (c.name as string).trim() && color(c.color) && str(c.home, 8192) && hibernate(c.hibernateAfterMin)
        && hiddenHibernate(c.hiddenHibernateMin) && (c.temporary === undefined || typeof c.temporary === 'boolean') && validIcon(c.icon) ? (c as UiCommand) : null;
    case 'workspace:update':
      return str(c.workspaceId, 64) && str(c.name, 30) && (c.name as string).trim() && color(c.color) && str(c.home, 8192)
        && hibernate(c.hibernateAfterMin) && hiddenHibernate(c.hiddenHibernateMin) && validIcon(c.icon) ? (c as UiCommand) : null;
    case 'tab:move':
      return id(c.tabId) && num(c.index) && Number.isInteger(c.index)
        && (c.groupId === undefined || c.groupId === null || id(c.groupId)) ? (c as UiCommand) : null;
    case 'tab:pin': return id(c.tabId) && typeof c.pinned === 'boolean' ? (c as UiCommand) : null;
    case 'tab:keep-awake': return id(c.tabId) && typeof c.keepAwake === 'boolean' ? (c as UiCommand) : null;
    case 'tab:duplicate':
    case 'tab:hibernate':
    case 'tab:reveal':
    case 'tab:hibernate-others':
    case 'tab:close-others':
    case 'tab:close-right':
    case 'group:create': return id(c.tabId) ? (c as UiCommand) : null;
    case 'tab:menu': return id(c.tabId) && num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'group:add': return id(c.tabId) && (c.groupId === null || id(c.groupId)) ? (c as UiCommand) : null;
    case 'group:update':
      return id(c.groupId) && str(c.name, 40) && groupColor(c.color) ? (c as UiCommand) : null;
    case 'group:collapse': return id(c.groupId) && typeof c.collapsed === 'boolean' ? (c as UiCommand) : null;
    case 'group:ungroup':
    case 'group:new-tab':
    case 'group:close': return id(c.groupId) ? (c as UiCommand) : null;
    case 'group:menu': return id(c.groupId) && num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'privacy:set':
      return ['global', 'workspace', 'site'].includes(c.scope as string) && typeof c.feature === 'string'
        && Object.hasOwn(PRIVACY_LABELS, c.feature) && (c.enabled === null || typeof c.enabled === 'boolean')
        && (c.workspaceId === undefined || id(c.workspaceId)) ? (c as UiCommand) : null;
    case 'privacy:pause-tab': return typeof c.paused === 'boolean' ? (c as UiCommand) : null;
    case 'privacy:reset-site': return { type: c.type } as UiCommand;
    case 'privacy:menu':
    case 'permission:menu': return num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'settings:dns':
      return ['secure', 'automatic', 'off'].includes(c.mode as string) && (c.dohUrl === null || validDohUrl(c.dohUrl))
        ? (c as UiCommand) : null;
    case 'settings:test-dns': return { type: c.type } as UiCommand;
    case 'settings:spellcheck': return (SPELLCHECK_MODES as unknown[]).includes(c.mode) ? (c as UiCommand) : null;
    case 'vault:connect':
      return validVaultServer(c.server) && typeof c.clientId === 'string' && /^(user|organization)\.[\w-]{1,100}$/.test(c.clientId.trim())
        && str(c.clientSecret, 256) && (c.clientSecret as string).trim() && password(c.password) ? (c as UiCommand) : null;
    case 'vault:unlock': return password(c.password) ? (c as UiCommand) : null;
    case 'vault:lock':
    case 'vault:sync':
    case 'vault:disconnect': return { type: c.type } as UiCommand;
    case 'vault:menu': return num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'vault:fill': return id(c.itemId) ? (c as UiCommand) : null;
    case 'vault:copy': return id(c.itemId) && ['username', 'password', 'totp'].includes(c.what as string) ? (c as UiCommand) : null;
    case 'vault:open':
    case 'vault:autofill': return { type: c.type } as UiCommand;
    case 'palette:toggle': return typeof c.open === 'boolean' ? (c as UiCommand) : null;
    case 'palette:query': return str(c.text, 500) ? (c as UiCommand) : null;
    case 'address:suggest': return str(c.text, 500) && num(c.x) && num(c.y) && num(c.width) ? (c as UiCommand) : null;
    case 'address:select': return Number.isInteger(c.index) && (c.index as number) >= -1 && (c.index as number) < 50 ? (c as UiCommand) : null;
    case 'address:close': return { type: c.type } as UiCommand;
    case 'settings:history': return typeof c.on === 'boolean' ? (c as UiCommand) : null;
    case 'history:clear': return { type: c.type } as UiCommand;
    case 'panel:add':
      return str(c.url, 2048) && /^https?:\/\//i.test(c.url as string) && id(c.workspaceId) && typeof c.mobile === 'boolean' ? (c as UiCommand) : null;
    case 'panel:toggle':
    case 'panel:remove': return id(c.panelId) ? (c as UiCommand) : null;
    case 'panel:set':
      return id(c.panelId) && (c.width === undefined || (Number.isInteger(c.width) && (c.width as number) >= PANEL_MIN_WIDTH && (c.width as number) <= PANEL_MAX_WIDTH))
        && (c.mobile === undefined || typeof c.mobile === 'boolean')
        && (c.hibernateMin === undefined || (PANEL_HIBERNATE_OPTIONS_MIN as readonly unknown[]).includes(c.hibernateMin)) ? (c as UiCommand) : null;
    case 'panel:hibernate': return id(c.panelId) ? (c as UiCommand) : null;
    case 'panel:bounds': return num(c.x) && num(c.y) && num(c.width) && num(c.height) ? (c as UiCommand) : null;
    case 'panel:menu': return id(c.panelId) && num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'module:set': return MODULES.some((m) => m.id === c.moduleId) && typeof c.enabled === 'boolean' ? (c as UiCommand) : null;
    case 'custom:save':
      return (c.id === undefined || id(c.id)) && str(c.name, 80) && (c.name as string).trim() && str(c.sites, 1000) && (c.sites as string).trim()
        && typeof c.css === 'string' && c.css.length <= MAX_CODE && typeof c.js === 'string' && c.js.length <= MAX_CODE
        && typeof c.enabled === 'boolean' ? (c as UiCommand) : null;
    case 'custom:delete': return id(c.id) ? (c as UiCommand) : null;
    case 'find:query':
      return str(c.text, 1000) && typeof c.forward === 'boolean' && typeof c.findNext === 'boolean' ? (c as UiCommand) : null;
    case 'default-browser:set': return { type: c.type } as UiCommand;
    case 'settings:vault-match': return c.match === 0 || c.match === 1 ? (c as UiCommand) : null;
    case 'settings:auto-pip':
    case 'settings:google-compat':
    case 'settings:pip-on-top': return typeof c.on === 'boolean' ? (c as UiCommand) : null;
    case 'reader:toggle': return { type: c.type } as UiCommand;
    case 'sync:connect':
      return (c.provider === 'google' || c.provider === 'onedrive') && str(c.clientId, 300) && (c.clientId as string).trim()
        && (c.clientSecret === null || str(c.clientSecret, 300)) && (c.provider === 'onedrive' || (typeof c.clientSecret === 'string' && c.clientSecret.trim()))
        && typeof c.passphrase === 'string' && c.passphrase.length >= 8 && c.passphrase.length <= 200 ? (c as UiCommand) : null;
    case 'sync:now':
    case 'sync:cancel':
    case 'sync:disconnect': return { type: c.type } as UiCommand;
    case 'split:open': return id(c.tabId) ? (c as UiCommand) : null;
    case 'split:close':
    case 'split:swap': return { type: c.type } as UiCommand;
    case 'split:ratio': return typeof c.ratio === 'number' && c.ratio >= 0.15 && c.ratio <= 0.85 ? (c as UiCommand) : null;
    case 'reader:style': {
      const st = c.style as Record<string, unknown> | undefined;
      return st && READER_SIZES.includes(st.size as number) && (st.font === 'serif' || st.font === 'sans')
        && ['light', 'sepia', 'dark'].includes(st.theme as string) && Object.keys(st).length === 3 ? (c as UiCommand) : null;
    }
    case 'update:check':
    case 'update:dismiss':
    case 'update:skip':
    case 'update:open-page':
    case 'tab:pip':
    case 'view:fullscreen':
    case 'tab:print':
    case 'tab:devtools': return { type: c.type } as UiCommand;
    case 'zoom:set': return ['in', 'out', 'reset'].includes(c.dir as string) ? (c as UiCommand) : null;
    case 'download:action':
      return id(c.downloadId) && ['pause', 'resume', 'cancel', 'open', 'show', 'remove'].includes(c.action as string) ? (c as UiCommand) : null;
    case 'settings:download-ask': return typeof c.ask === 'boolean' ? (c as UiCommand) : null;
    case 'settings:download-days': return (DOWNLOAD_KEEP_DAYS as readonly unknown[]).includes(c.days) ? (c as UiCommand) : null;
    case 'download:clear':
    case 'find:close':
    case 'bookmark:add': return { type: c.type } as UiCommand;
    case 'bookmark:update':
      return id(c.bookmarkId) && str(c.title, 300) && url(c.url) && (c.parentId === undefined || c.parentId === null || id(c.parentId)) ? (c as UiCommand) : null;
    case 'bookmark:rename': return id(c.bookmarkId) && str(c.title, 300) && (c.title as string).trim() ? (c as UiCommand) : null;
    case 'bookmark:add-folder':
      return str(c.title, 300) && (c.title as string).trim() && (c.parentId === null || id(c.parentId)) ? (c as UiCommand) : null;
    case 'bookmark:remove': return id(c.bookmarkId) ? (c as UiCommand) : null;
    case 'bookmark:move':
      return id(c.bookmarkId) && (c.parentId === null || id(c.parentId)) && num(c.index) && Number.isInteger(c.index) ? (c as UiCommand) : null;
    case 'bookmark:menu':
      return (c.folderId === null || id(c.folderId)) && num(c.x) && num(c.y)
        && (c.from === undefined || (num(c.from) && Number.isInteger(c.from))) ? (c as UiCommand) : null;
    case 'bookmark:context': return (c.bookmarkId === null || id(c.bookmarkId)) && num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'settings:bookmark-bar': return typeof c.show === 'boolean' ? (c as UiCommand) : null;
    case 'import:scan': return { type: c.type } as UiCommand;
    case 'import:bookmarks': return str(c.sourceId, 64) && id(c.workspaceId) ? (c as UiCommand) : null;
    case 'history:view': return typeof c.open === 'boolean' && str(c.query, 500) ? (c as UiCommand) : null;
    case 'history:delete': return url(c.url) ? (c as UiCommand) : null;
    case 'bookmark:open':
      return id(c.bookmarkId) && (c.newTab === undefined || typeof c.newTab === 'boolean') ? (c as UiCommand) : null;
    case 'screen:pick':
      return id(c.requestId) && (c.sourceId === null || str(c.sourceId, 256)) && typeof c.audio === 'boolean' ? (c as UiCommand) : null;
    case 'vault:save-answer':
      return id(c.promptId) && ['save', 'dismiss', 'never'].includes(c.action as string) ? (c as UiCommand) : null;
    case 'vault:generate': return typeof c.fill === 'boolean' ? (c as UiCommand) : null;
    case 'vault:generator':
      return (GENERATOR_LENGTHS as readonly unknown[]).includes(c.length) && typeof c.symbols === 'boolean' ? (c as UiCommand) : null;
    case 'vault:lock-after': return (LOCK_OPTIONS_MIN as readonly unknown[]).includes(c.minutes) ? (c as UiCommand) : null;
    case 'memory:toggle': return typeof c.open === 'boolean' ? (c as UiCommand) : null;
    case 'settings:memory-limit': return (MEMORY_LIMIT_OPTIONS_MB as readonly unknown[]).includes(c.mb) ? (c as UiCommand) : null;
    case 'layout:bounds': return num(c.x) && num(c.y) && num(c.width) && num(c.height) ? (c as UiCommand) : null;
    case 'layout:overlay': return typeof c.open === 'boolean' ? (c as UiCommand) : null;
    case 'permission:answer':
      return str(c.promptId, 64) && decision(c.decision) && typeof c.remember === 'boolean' ? (c as UiCommand) : null;
    case 'permission:set':
      return str(c.origin, 2048) && kind(c.kind) && (c.decision === null || decision(c.decision)) ? (c as UiCommand) : null;
    default: return null;
  }
}
