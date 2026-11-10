// Client hints nas requisições (sec-ch-ua…). Com o user agent trocado, o Chromium do
// Electron deixa de enviá-las; sites como o login do Google estranham um navegador sem
// nenhuma (ver user-agent.ts). Mesmas regras do Chromium: só em conexão segura; as de
// "alta entropia" só para quem pediu (Accept-CH).
import type { NetworkModule } from './network';
import { nativeUserAgent, needsNativeIdentity, uaMetadata, type UaMetadata } from './user-agent';

const brandList = (list: { brand: string; version: string }[]) => list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
const q = (s: string) => `"${s}"`;

/** Valor de cada hint (nome em minúsculas). */
export function hintValues(m: UaMetadata): Record<string, string> {
  return {
    'sec-ch-ua': brandList(m.brands),
    'sec-ch-ua-mobile': m.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': q(m.platform),
    'sec-ch-ua-full-version-list': brandList(m.fullVersionList),
    'sec-ch-ua-full-version': q(m.fullVersion),
    'sec-ch-ua-platform-version': q(m.platformVersion),
    'sec-ch-ua-arch': q(m.architecture),
    'sec-ch-ua-bitness': q(m.bitness),
    'sec-ch-ua-model': q(m.model),
    'sec-ch-ua-wow64': m.wow64 ? '?1' : '?0',
  };
}

export const LOW_ENTROPY = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

/** Conexão segura (https, ou localhost) — fora disso o Chromium não envia hints. */
export function secureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || ((u.protocol === 'http:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Hints pedidos por um site no cabeçalho Accept-CH (nomes em minúsculas, só os sec-ch-ua*). */
export function parseAcceptCh(value: string): string[] {
  return value.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.startsWith('sec-ch-ua'));
}

export function clientHintsModule(chromeVersion = process.versions.chrome): NetworkModule {
  const desktop = hintValues(uaMetadata(chromeVersion, false));
  const mobile = hintValues(uaMetadata(chromeVersion, true));
  /** origem → hints de alta entropia pedidos (Accept-CH vale para as próximas requisições). */
  const requested = new Map<string, Set<string>>();
  const originOf = (url: string) => { try { return new URL(url).origin; } catch { return null; } };
  return {
    name: 'client-hints',
    onBeforeSendHeaders(details, headers) {
      // Página de login do Google: a própria navegação já sai com a identificação original
      // do Electron (ver user-agent.ts); as client hints seguem iguais (Chromium).
      if ((details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && needsNativeIdentity(details.url)) {
        for (const k of Object.keys(headers)) if (k.toLowerCase() === 'user-agent') delete headers[k];
        headers['User-Agent'] = nativeUserAgent();
      }
      if (!secureUrl(details.url)) return;
      const keys = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
      if (keys.has('sec-ch-ua')) return; // o Chromium já mandou: não mexe
      const ua = Object.entries(headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1] ?? '';
      if (!/Chrome\//.test(ua)) return; // identificado como outro navegador: sem hints
      const values = /Android/.test(ua) ? mobile : desktop; // painel "versão para celular"
      const origin = originOf(details.url);
      for (const name of [...LOW_ENTROPY, ...(origin ? requested.get(origin) ?? [] : [])]) headers[name] = values[name] ?? headers[name];
    },
    onHeadersReceived(details, headers) {
      const accept = Object.entries(headers).find(([k]) => k.toLowerCase() === 'accept-ch')?.[1];
      const origin = originOf(details.url);
      if (!accept || !origin || !secureUrl(details.url)) return;
      const names = parseAcceptCh(Array.isArray(accept) ? accept.join(',') : accept).filter((n) => !LOW_ENTROPY.includes(n));
      if (names.length) requested.set(origin, new Set(names));
    },
  };
}
