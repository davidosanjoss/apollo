import { describe, expect, it } from 'vitest';
import type { IpcMainEvent, WebContents } from 'electron';
import { isTrustedSender, parseCommand } from '../../src/main/ipc';

describe('parseCommand (validação dos comandos da UI)', () => {
  it('aceita comandos válidos', () => {
    const valid = [
      { type: 'tab:new' },
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
