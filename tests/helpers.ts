import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db';
import { Store } from '../src/main/store';

/** Diretório temporário apagado no fim do teste (chame o retorno). */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-test-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Store num banco SQLite em memória, já migrado. */
export function memoryStore(): Store {
  return new Store(openDatabase(':memory:'));
}
