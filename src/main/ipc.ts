import type { IpcMainEvent, WebContents } from 'electron';
import type { PermissionKind, UiCommand } from '../shared/types';
import { GROUP_COLORS, HIBERNATE_OPTIONS_MIN, PERMISSION_LABELS } from '../shared/types';
import { UI_URL } from './protocol';

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
        ? (c as UiCommand) : null;
    case 'workspace:update':
      return str(c.workspaceId, 64) && str(c.name, 30) && (c.name as string).trim() && color(c.color) && str(c.home, 8192)
        && hibernate(c.hibernateAfterMin) ? (c as UiCommand) : null;
    case 'tab:move':
      return id(c.tabId) && num(c.index) && Number.isInteger(c.index)
        && (c.groupId === undefined || c.groupId === null || id(c.groupId)) ? (c as UiCommand) : null;
    case 'tab:pin': return id(c.tabId) && typeof c.pinned === 'boolean' ? (c as UiCommand) : null;
    case 'tab:keep-awake': return id(c.tabId) && typeof c.keepAwake === 'boolean' ? (c as UiCommand) : null;
    case 'tab:duplicate':
    case 'tab:hibernate':
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
    case 'group:close': return id(c.groupId) ? (c as UiCommand) : null;
    case 'group:menu': return id(c.groupId) && num(c.x) && num(c.y) ? (c as UiCommand) : null;
    case 'layout:bounds': return num(c.x) && num(c.y) && num(c.width) && num(c.height) ? (c as UiCommand) : null;
    case 'layout:overlay': return typeof c.open === 'boolean' ? (c as UiCommand) : null;
    case 'permission:answer':
      return str(c.promptId, 64) && decision(c.decision) && typeof c.remember === 'boolean' ? (c as UiCommand) : null;
    case 'permission:set':
      return str(c.origin, 2048) && kind(c.kind) && (c.decision === null || decision(c.decision)) ? (c as UiCommand) : null;
    default: return null;
  }
}
