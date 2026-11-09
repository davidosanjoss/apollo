import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/main/db';
import { tempDir } from '../helpers';

let cleanup = () => {};
afterEach(() => cleanup());

describe('openDatabase', () => {
  it('cria o schema e marca a versão', () => {
    const db = openDatabase(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['workspaces', 'tabs', 'tab_groups', 'site_permissions', 'kv']));
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBeGreaterThan(0);
    expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('reabrir não reaplica migrações nem perde dados', () => {
    const t = tempDir(); cleanup = t.cleanup;
    const file = path.join(t.dir, 'apollo.db');
    const a = openDatabase(file);
    a.prepare("INSERT INTO kv(key, value) VALUES ('x', '1')").run();
    a.close();
    const b = openDatabase(file);
    expect(b.prepare("SELECT value FROM kv WHERE key = 'x'").get()).toEqual({ value: '1' });
    b.close();
  });

  it('recusa banco de uma versão mais nova do Apollo (não corrompe dados)', () => {
    const t = tempDir(); cleanup = t.cleanup;
    const file = path.join(t.dir, 'apollo.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 999');
    raw.close();
    expect(() => openDatabase(file)).toThrow(/versão mais nova/);
  });
});
