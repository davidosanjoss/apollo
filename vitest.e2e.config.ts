import { defineConfig } from 'vitest/config';

// Testes de integração: abrem o Apollo de verdade (build/) e o controlam via CDP.
// Rodar `npm run build` antes. Em Linux sem tela, usar xvfb-run.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
