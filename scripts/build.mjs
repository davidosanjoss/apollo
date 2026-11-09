// Build: TypeScript → build/ com esbuild. Checagem de tipos fica no `npm run typecheck`.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync } from 'node:fs';

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

console.log(`build ok${prod ? ' (produção)' : ''}`);
