// Fase 0: valida as premissas técnicas do Apollo nesta máquina.
// Uso: npm run diagnose
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBin = require('electron'); // caminho do binário
const profile = mkdtempSync(join(tmpdir(), 'apollo-diag-'));

function run(phase) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, ['.', `--diagnose=${phase}`], {
      env: { ...process.env, APOLLO_USER_DATA: profile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {}); // ruído do Chromium
    const timer = setTimeout(() => { child.kill(); reject(new Error(`fase ${phase}: timeout`)); }, 90_000);
    child.on('exit', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('APOLLO_DIAG '));
      if (!line) return reject(new Error(`fase ${phase}: sem relatório\n${out}`));
      resolve(JSON.parse(line.slice('APOLLO_DIAG '.length)));
    });
  });
}

const ok = (b) => (b ? '✅' : '❌');

try {
  await run('set');
  const r = await run('check');
  if (r.fatal) throw new Error(r.fatal);

  console.log(`\nApollo — diagnóstico (${r.platform}, Electron ${r.electron})\n`);
  console.log(`${ok(r.cookies.persistentCookieSurvivedRestart)} Cookie persistente sobrevive ao reiniciar`);
  console.log(`${ok(r.cookies.sessionCookieSurvivedRestart)} Cookie de SESSÃO sobrevive ao reiniciar`);
  console.log(`${ok(r.widevine.ok)} Widevine (DRM) ${r.widevine.ok ? '' : `— ${r.widevine.error}`}`);
  console.log(`   componentes: ${JSON.stringify(r.widevineComponent)}`);
  console.log(`${ok(r.gpu.video_decode?.startsWith('enabled'))} Decodificação de vídeo na GPU: ${r.gpu.video_decode}`);
  for (const [codec, info] of Object.entries(r.decoding)) {
    console.log(`   ${codec.padEnd(5)} suportado=${info.supported} fluido=${info.smooth} hardware=${info.hardware}`);
  }
  console.log(`${ok(r.userAgentClean)} User agent sem "Electron": ${r.userAgent}`);
  console.log(`${ok(r.dns.resolveOk)} DNS seguro (${r.dns.mode}, ${r.dns.provider ?? '-'})${r.dns.error ? ` — ${r.dns.error}` : ''}`);
  console.log('\nTeste manual de login: veja docs/phase-0.md\n');
} catch (err) {
  console.error('Diagnóstico falhou:', err.message);
  process.exitCode = 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
