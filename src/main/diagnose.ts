// Modo de diagnóstico da fase 0. Roda via `npm run diagnose`, que chama o app
// duas vezes (fase "set" e fase "check") com um perfil temporário.
import { app, components, session, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { DnsInfo } from './settings';

const DIAG_URL = 'https://apollo.invalid';
const step = (msg: string) => process.stderr.write(`[diag] ${msg}\n`);

async function withSecurePage<T>(fn: (evaluate: (code: string) => Promise<any>) => Promise<T>): Promise<T> {
  // EME e MediaCapabilities exigem contexto seguro; file:// conta como seguro.
  const file = path.join(app.getPath('userData'), 'diag.html');
  fs.writeFileSync(file, '<!doctype html><title>diag</title>');
  const win = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:diag' } });
  try {
    await win.loadFile(file);
    return await fn((code: string) => win.webContents.executeJavaScript(code));
  } finally {
    win.destroy();
    fs.rmSync(file, { force: true });
  }
}

const WIDEVINE_PROBE = `
  navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
    initDataTypes: ['cenc'],
    videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: 'SW_SECURE_CRYPTO' }],
  }]).then((a) => ({ ok: true, keySystem: a.keySystem }))
     .catch((e) => ({ ok: false, error: e.name + ': ' + e.message }))
`;

// powerEfficient=true indica decodificação por hardware para aquele codec.
const DECODE_PROBE = `
  Promise.all([
    ['h264', 'video/mp4; codecs="avc1.640028"'],
    ['vp9',  'video/webm; codecs="vp09.00.40.08"'],
    ['av1',  'video/mp4; codecs="av01.0.08M.08"'],
  ].map(([name, contentType]) =>
    navigator.mediaCapabilities.decodingInfo({
      type: 'media-source',
      video: { contentType, width: 1920, height: 1080, bitrate: 5e6, framerate: 30 },
    }).then((r) => [name, { supported: r.supported, smooth: r.smooth, hardware: r.powerEfficient }])
      .catch((e) => [name, { error: e.message }])
  )).then(Object.fromEntries)
`;

export async function runDiagnose(phase: string, dnsInfo: DnsInfo): Promise<void> {
  const report: Record<string, any> = { phase, platform: process.platform, electron: process.versions.electron };
  const ses = session.fromPartition('persist:diag');

  try {
    if (phase === 'set') {
      // Cookie de sessão (sem expiração) + cookie persistente, para comparar após reiniciar.
      await ses.cookies.set({ url: DIAG_URL, name: 'session_cookie', value: '1', secure: true });
      await ses.cookies.set({
        url: DIAG_URL, name: 'persistent_cookie', value: '1', secure: true,
        expirationDate: Math.floor(Date.now() / 1000) + 3600,
      });
      await ses.cookies.flushStore();
      report.cookiesSet = true;
    } else {
      step('cookies');
      const cookies = await ses.cookies.get({ url: DIAG_URL });
      report.cookies = {
        sessionCookieSurvivedRestart: cookies.some((c) => c.name === 'session_cookie'),
        persistentCookieSurvivedRestart: cookies.some((c) => c.name === 'persistent_cookie'),
      };

      step('widevine component');
      await components.whenReady();
      report.widevineComponent = components.status();
      step('widevine + decode probes');
      await withSecurePage(async (evaluate) => {
        report.widevine = await evaluate(WIDEVINE_PROBE);
        report.decoding = await evaluate(DECODE_PROBE);
      });

      step('gpu');
      const gpu = app.getGPUFeatureStatus();
      report.gpu = { video_decode: gpu.video_decode, gpu_compositing: gpu.gpu_compositing };

      report.userAgent = ses.getUserAgent();
      report.userAgentClean = !/Electron|apollo/i.test(report.userAgent);

      step('dns');
      report.dns = dnsInfo;
      // Requisição real pela sessão: valida a resolução de nomes no modo configurado.
      try {
        const res = await ses.fetch('https://example.com/', { signal: AbortSignal.timeout(15_000) });
        report.dns.resolveOk = res.ok;
      } catch (e) {
        report.dns.resolveOk = false;
        report.dns.error = (e as Error).message;
      }
    }
  } catch (err) {
    report.fatal = String((err as Error)?.stack || err);
  }

  process.stdout.write(`APOLLO_DIAG ${JSON.stringify(report)}\n`);
  app.exit(0);
}

