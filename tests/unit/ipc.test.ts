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
      { type: 'privacy:set', scope: 'site', feature: 'ads', enabled: false },
      { type: 'privacy:set', scope: 'workspace', feature: 'trackers', enabled: null, workspaceId: 'w' },
      { type: 'privacy:set', scope: 'global', feature: 'ads', enabled: true },
      { type: 'privacy:pause-tab', paused: true },
      { type: 'privacy:reset-site' },
      { type: 'vault:connect', server: 'us', clientId: 'user.1234-abcd', clientSecret: 'x', password: 'y' },
      { type: 'vault:connect', server: 'https://cofre.lan', clientId: 'organization.ab_c', clientSecret: 'x', password: 'y' },
      { type: 'vault:unlock', password: 'senha' },
      { type: 'vault:lock' },
      { type: 'vault:lock-after', minutes: 15 },
      { type: 'vault:menu', x: 1, y: 2 },
      { type: 'vault:fill', itemId: 'item-1' },
      { type: 'vault:copy', itemId: 'item-1', what: 'totp' },
      { type: 'vault:open' },
      { type: 'settings:spellcheck', mode: 'off' },
      { type: 'bookmark:add' },
      { type: 'find:query', text: 'cálculo', forward: true, findNext: false },
      { type: 'find:close' },
      { type: 'zoom:set', dir: 'in' },
      { type: 'zoom:set', dir: 'reset' },
      { type: 'palette:query', text: 'cálculo' },
      { type: 'view:fullscreen' },
      { type: 'update:check' },
      { type: 'tab:pip' },
      { type: 'reader:toggle' },
      { type: 'split:open', tabId: 't1' },
      { type: 'split:close' },
      { type: 'split:swap' },
      { type: 'split:ratio', ratio: 0.4 },
      { type: 'reader:style', style: { size: 21, font: 'sans', theme: 'dark' } },
      { type: 'settings:auto-pip', on: true },
      { type: 'settings:pip-on-top', on: false },
      { type: 'default-browser:set' },
      { type: 'settings:download-days', days: 30 },
      { type: 'settings:download-days', days: 0 },
      { type: 'update:dismiss' },
      { type: 'update:skip' },
      { type: 'update:open-page' },
      { type: 'tab:print' },
      { type: 'tab:devtools' },
      { type: 'settings:history', on: false },
      { type: 'history:clear' },
      { type: 'bookmark:update', bookmarkId: 'b1', title: 'Moodle', url: 'https://moodle.ufmg.br/' },
      { type: 'bookmark:remove', bookmarkId: 'b1' },
      { type: 'bookmark:move', bookmarkId: 'b1', parentId: null, index: 0 },
      { type: 'bookmark:move', bookmarkId: 'b1', parentId: 'f1', index: 2 },
      { type: 'bookmark:add-folder', title: 'Faculdade', parentId: null },
      { type: 'bookmark:rename', bookmarkId: 'f1', title: 'Fac' },
      { type: 'bookmark:menu', folderId: 'f1', x: 10, y: 20 },
      { type: 'bookmark:menu', folderId: null, x: 10, y: 20, from: 3 },
      { type: 'bookmark:context', bookmarkId: null, x: 1, y: 2 },
      { type: 'settings:bookmark-bar', show: false },
      { type: 'history:view', open: true, query: '' },
      { type: 'history:delete', url: 'https://a.com/' },
      { type: 'bookmark:open', bookmarkId: 'b1', newTab: true },
      { type: 'vault:autofill' },
      { type: 'palette:toggle', open: true },
      { type: 'panel:add', url: 'https://web.whatsapp.com/', workspaceId: 'w1', mobile: false },
      { type: 'panel:toggle', panelId: 'p1' },
      { type: 'panel:set', panelId: 'p1', width: 520 },
      { type: 'panel:set', panelId: 'p1', width: 377 },
      { type: 'panel:set', panelId: 'p1', hibernateMin: null },
      { type: 'panel:set', panelId: 'p1', hibernateMin: 0 },
      { type: 'panel:hibernate', panelId: 'p1' },
      { type: 'workspace:update', workspaceId: 'w', name: 'X', color: '#000000', home: '', hibernateAfterMin: -1, hiddenHibernateMin: null },
      { type: 'workspace:create', name: 'X', color: '#000000', home: '', hiddenHibernateMin: -1 },
      { type: 'panel:set', panelId: 'p1', mobile: true },
      { type: 'panel:bounds', x: 0, y: 0, width: 420, height: 700 },
      { type: 'panel:menu', panelId: 'p1', x: 1, y: 1 },
      { type: 'module:set', moduleId: 'gpc', enabled: false },
      { type: 'custom:save', name: 'YouTube', sites: 'youtube.com', css: 'a{}', js: '', enabled: true },
      { type: 'custom:save', id: 'c1', name: 'YouTube', sites: '*', css: '', js: 'x()', enabled: false },
      { type: 'custom:delete', id: 'c1' },
      { type: 'vault:save-answer', promptId: 'p1', action: 'never' },
      { type: 'vault:generate', fill: true },
      { type: 'vault:generator', length: 20, symbols: false },
      { type: 'privacy:menu', x: 10, y: 40 },
      { type: 'permission:menu', x: 0, y: 40 },
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
      { type: 'group:new-tab', groupId: 'g' },
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
      { type: 'privacy:set', scope: 'aba', feature: 'ads', enabled: false },
      { type: 'privacy:set', scope: 'site', feature: 'toString', enabled: false },
      { type: 'privacy:set', scope: 'site', feature: 'ads', enabled: 'nao' },
      { type: 'privacy:pause-tab' },
      { type: 'privacy:menu', x: -1, y: 0 },
      { type: 'vault:connect', server: 'http://cofre.lan', clientId: 'user.1', clientSecret: 'x', password: 'y' },
      { type: 'vault:connect', server: 'us', clientId: 'qualquer', clientSecret: 'x', password: 'y' },
      { type: 'vault:connect', server: 'us', clientId: 'user.1', clientSecret: '   ', password: 'y' },
      { type: 'vault:unlock', password: '' },
      { type: 'vault:unlock', password: 'x'.repeat(1025) },
      { type: 'vault:lock-after', minutes: 2 },
      { type: 'vault:copy', itemId: 'item-1', what: 'notas' },
      { type: 'vault:fill', itemId: '' },
      { type: 'vault:save-answer', promptId: 'p1', action: 'talvez' },
      { type: 'vault:generator', length: 7, symbols: true },
      { type: 'vault:generate' },
      { type: 'palette:toggle' },
      { type: 'settings:spellcheck', mode: 'fr' },
      { type: 'bookmark:update', bookmarkId: 'b1', title: 'x', url: 'javascript:alert(1)' },
      { type: 'bookmark:move', bookmarkId: 'b1', parentId: null, index: -1 },
      { type: 'bookmark:move', bookmarkId: 'b1', index: 0 },
      { type: 'bookmark:add-folder', title: '  ', parentId: null },
      { type: 'bookmark:menu', folderId: 'f1', x: -5, y: 0 },
      { type: 'history:delete', url: 'javascript:alert(1)' },
      { type: 'bookmark:open', bookmarkId: '' },
      { type: 'find:query', text: 'x'.repeat(1001), forward: true, findNext: false },
      { type: 'find:query', text: 'x', forward: 'sim', findNext: false },
      { type: 'zoom:set', dir: 'muito' },
      { type: 'palette:query', text: 'x'.repeat(501) },
      { type: 'settings:download-days', days: 3 },
      { type: 'split:ratio', ratio: 0.95 },
      { type: 'split:open', tabId: '' },
      { type: 'reader:style', style: { size: 20, font: 'sans', theme: 'dark' } },
      { type: 'reader:style', style: { size: 21, font: 'sans', theme: 'dark', css: 'x' } },
      { type: 'panel:add', url: 'javascript:alert(1)', workspaceId: 'w1', mobile: false },
      { type: 'panel:add', url: 'apollo://ui/index.html', workspaceId: 'w1', mobile: false },
      { type: 'panel:set', panelId: 'p1', width: 100 },
      { type: 'panel:set', panelId: 'p1', width: 5000 },
      { type: 'panel:set', panelId: 'p1', width: 400.5 },
      { type: 'panel:set', panelId: 'p1', hibernateMin: 7 },
      { type: 'workspace:create', name: 'X', color: '#000000', home: '', hiddenHibernateMin: 3 },
      { type: 'module:set', moduleId: 'inventado', enabled: false },
      { type: 'custom:save', name: '', sites: 'a.com', css: '', js: '', enabled: true },
      { type: 'custom:save', name: 'x', sites: ' ', css: '', js: '', enabled: true },
      { type: 'custom:save', name: 'x', sites: 'a.com', css: 'a'.repeat(100_001), js: '', enabled: true },
      { type: 'permission:menu', x: 5 },
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

describe('ícone do workspace', () => {
  it('aceita um emoji (inclusive composto) ou até 2 caracteres; recusa HTML, espaços e textos', async () => {
    const { validIcon } = await import('../../src/main/ipc');
    for (const ok of [undefined, null, '🏠', '✈️', '👨‍👩‍👧', '❤️', 'AB']) expect(validIcon(ok)).toBe(true);
    for (const bad of ['', ' 🏠', '<b>', 'abc', '🏠🏠🏠', 42, 'a"']) expect(validIcon(bad)).toBe(false);
  });
});
