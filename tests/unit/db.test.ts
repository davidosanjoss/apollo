import fs from 'node:fs';
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

  // Regressão: o erro deixava o arquivo aberto; no Windows ele ficava travado
  // (EPERM ao apagar/restaurar o banco). Só reproduz no Windows (CI).
  it('fecha o arquivo quando recusa o banco', () => {
    const t = tempDir(); cleanup = t.cleanup;
    const file = path.join(t.dir, 'apollo.db');
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 999');
    raw.close();
    expect(() => openDatabase(file)).toThrow();
    expect(() => fs.rmSync(file)).not.toThrow();
  });

  it('banco da v0.2.0 (schema v1) com dados migra sem perder nada', () => {
    const t = tempDir(); cleanup = t.cleanup;
    const file = path.join(t.dir, 'apollo.db');
    const v1 = new DatabaseSync(file);
    v1.exec(V1_SCHEMA);
    v1.exec(`PRAGMA user_version = 1;
      INSERT INTO workspaces(id, name, color, home, position, active_tab_id, created_at) VALUES ('w', 'Pessoal', '#000000', 'apollo://home', 0, 't', 1);
      INSERT INTO tabs(id, workspace_id, position, url, title) VALUES ('t', 'w', 0, 'https://a.com/', 'A');`);
    v1.close();

    const db = openDatabase(file);
    expect(db.prepare('SELECT name FROM workspaces').all()).toEqual([{ name: 'Pessoal' }]);
    expect(db.prepare('SELECT id, url, history, keep_awake FROM tabs').all()).toEqual([{ id: 't', url: 'https://a.com/', history: null, keep_awake: 0 }]);
    expect(db.prepare('SELECT hibernate_after_min FROM workspaces').get()).toEqual({ hibernate_after_min: 30 });
    db.close();
  });
});

// Schema exatamente como saiu na v0.2.0 (para testar a migração v1 → atual).
const V1_SCHEMA = `
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, home TEXT NOT NULL,
    position INTEGER NOT NULL, active_tab_id TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE tab_groups (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);
  CREATE TABLE tabs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    group_id TEXT REFERENCES tab_groups(id) ON DELETE SET NULL, position INTEGER NOT NULL, url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', favicon TEXT, pinned INTEGER NOT NULL DEFAULT 0, last_active_at INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX tabs_by_workspace ON tabs(workspace_id, position);
  CREATE TABLE site_permissions (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    origin TEXT NOT NULL, kind TEXT NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    updated_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, origin, kind));
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
