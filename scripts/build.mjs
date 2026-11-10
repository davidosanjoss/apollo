// Build: TypeScript → build/ com esbuild. Checagem de tipos fica no `npm run typecheck`.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { buildFilters } from './build-filters.mjs';

const prod = process.argv.includes('--prod');
rmSync('build', { recursive: true, force: true });

const common = { bundle: true, sourcemap: prod ? false : 'inline', minify: prod, logLevel: 'warning' };

await Promise.all([
  // Processo principal
  build({
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'build/main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron', 'electron-updater'],
  }),
  // Modo leitura: injetado num mundo isolado da página (texto lido pelo processo principal).
  build({
    ...common,
    entryPoints: ['src/reader/inject.ts'],
    outfile: 'build/reader.js',
    sourcemap: false, // injetado em páginas: pequeno sempre
    minify: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
  }),
  // Preload das abas (filtros cosméticos e scriptlets). Sandbox: só o módulo electron.
  build({
    ...common,
    entryPoints: ['src/preload/tab.ts'],
    outfile: 'build/tab-preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  }),
  // Atualização das listas de bloqueio (thread separada)
  build({
    ...common,
    entryPoints: ['src/main/privacy/filters-worker.ts'],
    outfile: 'build/filters-worker.js',
    platform: 'node',
    format: 'cjs',
    target: 'node24',
  }),
  // Preload da UI (roda em sandbox: só pode usar o módulo electron)
  build({
    ...common,
    entryPoints: ['src/preload/ui.ts'],
    outfile: 'build/preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  }),
  // UI
  build({
    ...common,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'build/pages/ui/app.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
  }),
]);

// Arquivos estáticos
mkdirSync('build/pages/ui', { recursive: true });
cpSync('src/renderer/index.html', 'build/pages/ui/index.html');
cpSync('src/renderer/styles.css', 'build/pages/ui/styles.css');
cpSync('src/pages', 'build/pages', { recursive: true });

await buildFilters();

console.log(`build ok${prod ? ' (produção)' : ''}`);
