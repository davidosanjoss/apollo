import { defineConfig } from 'vitest/config';

// Compatibilidade com o Bitwarden real: Vaultwarden em Docker + CLI oficial.
// Precisa de docker, openssl e internet (baixar a imagem e o CLI na primeira vez).
export default defineConfig({
  test: {
    include: ['tests/interop/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    globalSetup: ['tests/interop/global-setup.ts'],
    pool: 'forks',
  },
});
