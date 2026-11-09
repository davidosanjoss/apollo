import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Testes unitários: rodam em Node puro, sem abrir o Electron.
// O módulo 'electron' é trocado por um stub (tests/stubs/electron.ts).
export default defineConfig({
  resolve: {
    alias: { electron: path.resolve(import.meta.dirname, 'tests/stubs/electron.ts') },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
