import { DatabaseSync } from 'node:sqlite';

// Migrações em ordem. Nunca editar uma já lançada: sempre adicionar uma nova.
const MIGRATIONS: string[] = [
  /* v1 */ `
  CREATE TABLE workspaces (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    color         TEXT NOT NULL,
    home          TEXT NOT NULL,
    position      INTEGER NOT NULL,
    active_tab_id TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE tab_groups (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    color        TEXT NOT NULL,
    collapsed    INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL
  );

  CREATE TABLE tabs (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    group_id       TEXT REFERENCES tab_groups(id) ON DELETE SET NULL,
    position       INTEGER NOT NULL,
    url            TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    favicon        TEXT,
    pinned         INTEGER NOT NULL DEFAULT 0,
    last_active_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX tabs_by_workspace ON tabs(workspace_id, position);

  -- Decisões de permissão por workspace + origem (ex.: microfone no Teams do Trabalho).
  CREATE TABLE site_permissions (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    origin       TEXT NOT NULL,
    kind         TEXT NOT NULL,
    decision     TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, origin, kind)
  );

  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  /* v2: fase 2 — histórico por aba, cookies de sessão, hibernação */ `
  ALTER TABLE tabs ADD COLUMN history TEXT;
  ALTER TABLE tabs ADD COLUMN keep_awake INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE workspaces ADD COLUMN hibernate_after_min INTEGER NOT NULL DEFAULT 30;

  -- Cookies de sessão de cada workspace, cifrados (ver session-cookies.ts).
  CREATE TABLE session_cookies (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    data         BLOB NOT NULL,
    saved_at     INTEGER NOT NULL
  );
  `,
];

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    migrate(db);
  } catch (err) {
    // Sem fechar, o arquivo fica travado (no Windows não dá nem para apagar/restaurar).
    db.close();
    throw err;
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (current > MIGRATIONS.length) {
    throw new Error(`Banco de dados é de uma versão mais nova do Apollo (schema v${current}).`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
