import { describe, expect, it } from 'vitest';
import type { IpcMainEvent, WebContents } from 'electron';
import { isTrustedSender, parseCommand } from '../../src/main/ipc';

describe('parseCommand (validação dos comandos da UI)', () => {
  it('aceita comandos válidos', () => {
    const valid = [
      { type: 'tab:new' },
      { type: 'tab:reopen' },
      { type: 'tab:new', url: 'https://example.com' },
      { type: 'tab:close', tabId: 'abc' },
      { type: 'tab:activate', tabId: 'abc' },
      { type: 'tab:navigate', url: 'apollo://home' },
      { type: 'workspace:switch', workspaceId: 'w1' },
      { type: 'workspace:delete', workspaceId: 'w1' },
      { type: 'workspace:create', name: 'Trabalho', color: '#AABBCC', home: '' },
      { type: 'workspace:update', workspaceId: 'w1', name: 'X', color: '#000000', home: 'https://a.com' },
      { type: 'layout:bounds', x: 0, y: 80, width: 1200, height: 700 },
      { type: 'layout:overlay', open: true },
      { type: 'permission:answer', promptId: 'p', decision: 'allow', remember: false },
      { type: 'permission:set', origin: 'https://a.com', kind: 'notifications', decision: null },
      { type: 'permission:set', origin: 'https://a.com', kind: 'geolocation', decision: 'deny' },
      { type: 'tab:move', tabId: 't', index: 0 },
      { type: 'tab:move', tabId: 't', index: 3, groupId: null },
      { type: 'tab:move', tabId: 't', index: 3, groupId: 'g' },
      { type: 'tab:pin', tabId: 't', pinned: true },
      { type: 'tab:keep-awake', tabId: 't', keepAwake: false },
      { type: 'tab:duplicate', tabId: 't' },
      { type: 'tab:hibernate', tabId: 't' },
      { type: 'tab:hibernate-others', tabId: 't' },
      { type: 'tab:reveal', tabId: 't' },
      { type: 'memory:toggle', open: true },
      { type: 'settings:memory-limit', mb: 0 },
      { type: 'settings:memory-limit', mb: 4096 },
      { type: 'workspace:create', name: 'X', color: '#000000', home: '', hibernateAfterMin: 0 },
      { type: 'workspace:update', workspaceId: 'w', name: 'X', color: '#000000', home: '', hibernateAfterMin: 240 },
      { type: 'tab:close-others', tabId: 't' },
      { type: 'tab:close-right', tabId: 't' },
      { type: 'tab:menu', tabId: 't', x: 10, y: 20 },
      { type: 'group:create', tabId: 't' },
      { type: 'group:add', tabId: 't', groupId: null },
      { type: 'group:update', groupId: 'g', name: '', color: '#4c8bf5' },
      { type: 'group:collapse', groupId: 'g', collapsed: true },
      { type: 'group:ungroup', groupId: 'g' },
      { type: 'group:close', groupId: 'g' },
      { type: 'group:menu', groupId: 'g', x: 0, y: 0 },
    ];
    for (const cmd of valid) expect(parseCommand(cmd), JSON.stringify(cmd)).not.toBeNull();
  });

  it('comandos sem dados devolvem só o tipo (descarta campos extras)', () => {
    expect(parseCommand({ type: 'tab:reload', evil: 1 })).toEqual({ type: 'tab:reload' });
  });

  it('rejeita lixo e comandos malformados', () => {
    const invalid: unknown[] = [
      null, undefined, 'tab:new', 42, [],
      { type: 'desconhecido' },
      { type: 'tab:close' },
      { type: 'tab:close', tabId: 'x'.repeat(65) },
      { type: 'tab:navigate', url: 'javascript:alert(1)' },
      { type: 'tab:navigate', url: 'chrome://settings' },
      { type: 'tab:new', url: 'javascript:alert(1)' },
      { type: 'workspace:create', name: '', color: '#000000', home: '' },
      { type: 'workspace:create', name: '   ', color: '#000000', home: '' },
      { type: 'workspace:create', name: 'x'.repeat(31), color: '#000000', home: '' },
      { type: 'workspace:create', name: 'ok', color: 'red', home: '' },
      { type: 'workspace:create', name: 'ok', color: '#000000' },
      { type: 'layout:bounds', x: -1, y: 0, width: 10, height: 10 },
      { type: 'layout:bounds', x: NaN, y: 0, width: 10, height: 10 },
      { type: 'layout:bounds', x: 0, y: 0, width: Infinity, height: 10 },
      { type: 'layout:overlay', open: 'yes' },
      { type: 'permission:answer', promptId: 'p', decision: 'maybe', remember: true },
      { type: 'permission:answer', promptId: 'p', decision: 'allow' },
      { type: 'permission:set', origin: 'https://a.com', kind: 'camera', decision: 'allow' },
      { type: 'permission:set', origin: 'https://a.com', kind: 'toString', decision: 'allow' },
      { type: 'tab:move', tabId: 't', index: 1.5 },
      { type: 'tab:move', tabId: 't', index: -1 },
      { type: 'tab:move', tabId: '', index: 0 },
      { type: 'tab:pin', tabId: 't', pinned: 'sim' },
      { type: 'tab:menu', tabId: 't', x: 10 },
      { type: 'group:add', tabId: 't' },
      { type: 'group:update', groupId: 'g', name: 'x'.repeat(41), color: '#4c8bf5' },
      { type: 'group:update', groupId: 'g', name: 'ok', color: '#123456' },
      { type: 'group:collapse', groupId: 'g' },
      { type: 'workspace:create', name: 'X', color: '#000000', home: '', hibernateAfterMin: 7 },
      { type: 'workspace:update', workspaceId: 'w', name: 'X', color: '#000000', home: '', hibernateAfterMin: '30' },
      { type: 'tab:hibernate' },
      { type: 'memory:toggle' },
      { type: 'settings:memory-limit', mb: 5 },
      { type: 'settings:memory-limit', mb: '4096' },
    ];
    for (const cmd of invalid) expect(parseCommand(cmd), JSON.stringify(cmd)).toBeNull();
  });
});

describe('isTrustedSender', () => {
  const mainFrame = { url: 'apollo://ui/index.html' };
  const ui = { mainFrame } as unknown as WebContents;
  const event = (over: Partial<{ sender: unknown; senderFrame: unknown }>) =>
    ({ sender: ui, senderFrame: mainFrame, ...over }) as unknown as IpcMainEvent;

  it('aceita o frame principal da UI', () => {
    expect(isTrustedSender(event({}), ui)).toBe(true);
  });

  it('rejeita outra webContents, subframe ou outra URL', () => {
    expect(isTrustedSender(event({ sender: {} }), ui)).toBe(false);
    expect(isTrustedSender(event({ senderFrame: { url: 'apollo://ui/index.html' } }), ui)).toBe(false);
    const evil = { url: 'https://evil.com/' };
    const uiEvil = { mainFrame: evil } as unknown as WebContents;
    expect(isTrustedSender({ sender: uiEvil, senderFrame: evil } as unknown as IpcMainEvent, uiEvil)).toBe(false);
    expect(isTrustedSender(event({ senderFrame: null }), ui)).toBe(false);
  });
});
