// Identificação do navegador para os sites.
//
// O setUserAgent do Electron troca o texto do user agent mas APAGA as "client hints"
// (navigator.userAgentData e os cabeçalhos sec-ch-ua). Sem nenhuma marca, o Google trata
// o Apollo como navegador embutido/inseguro ("Couldn't sign you in"). Pelo protocolo de
// depuração do próprio Chromium dá para definir o texto E os metadados, como um Chromium
// comum faz (marca "Chromium"; não fingimos ser o Google Chrome).
import type { WebContents } from 'electron';

/** Texto do user agent sem "Electron/x" e sem o nome do app. */
export const cleanUserAgent = (ua: string) => ua.replace(/\sElectron\/\S+/i, '').replace(/\sapollo\/\S+/i, '');

const PLATFORM: Record<string, string> = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' };

export interface UaMetadata {
  brands: { brand: string; version: string }[];
  fullVersionList: { brand: string; version: string }[];
  fullVersion: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  model: string;
  mobile: boolean;
  bitness: string;
  wow64: boolean;
}

export function uaMetadata(chromeVersion: string, mobile: boolean, os = process.platform, arch = process.arch): UaMetadata {
  const major = chromeVersion.split('.')[0];
  return {
    // Marca "GREASE" como o Chromium faz (sites não podem depender da lista exata).
    brands: [{ brand: 'Chromium', version: major }, { brand: 'Not-A.Brand', version: '24' }],
    fullVersionList: [{ brand: 'Chromium', version: chromeVersion }, { brand: 'Not-A.Brand', version: '24.0.0.0' }],
    fullVersion: chromeVersion,
    platform: mobile ? 'Android' : PLATFORM[os] ?? 'Linux',
    platformVersion: '',
    architecture: mobile ? '' : arch === 'arm64' ? 'arm' : 'x86',
    model: mobile ? 'Pixel 8' : '',
    mobile,
    bitness: mobile ? '' : '64',
    wow64: false,
  };
}

// ------------------------------------------------------------ compatibilidade por site

/**
 * O login do Google recusa navegadores feitos com Electron mesmo bem identificados
 * ("This browser or app may not be secure"). Outros navegadores Electron (Ferdium, Rambox,
 * Min) passam se identificando como Firefox SÓ nessas páginas — como as intervenções de
 * compatibilidade por site do próprio Firefox. Opção nas Configurações (ligada por padrão).
 */
let googleCompat = true;
export const setGoogleCompat = (on: boolean) => { googleCompat = on; };

export function firefoxUserAgent(os = process.platform): string {
  const platform = os === 'win32' ? 'Windows NT 10.0; Win64; x64' : os === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}; rv:140.0) Gecko/20100101 Firefox/140.0`;
}

/** Endereços que usam a identificação de Firefox (com a opção ligada). */
export function needsFirefoxIdentity(url: string): boolean {
  if (!googleCompat) return false;
  // Testes: um host local no lugar do Google.
  const hosts = ['accounts.google.com', ...(process.env.APOLLO_TEST_COMPAT_HOST ? [process.env.APOLLO_TEST_COMPAT_HOST] : [])];
  try { return hosts.includes(new URL(url).hostname); } catch { return false; }
}

/** navigator.platform como no Chrome. */
const navigatorPlatform = (mobile: boolean, os = process.platform) =>
  mobile ? 'Linux armv81' : os === 'win32' ? 'Win32' : os === 'darwin' ? 'MacIntel' : 'Linux x86_64';

/**
 * Aplica texto + metadados à página (antes da primeira navegação, de preferência).
 * Se as ferramentas do desenvolvedor tomarem o lugar, reaplica quando fecharem.
 */
export function applyUserAgent(wc: WebContents, userAgent: string, mobile = false): void {
  let firefox = false;
  const send = () => {
    if (wc.isDestroyed()) return;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    } catch {
      return; // devtools aberto: tenta de novo quando fechar
    }
    void wc.debugger.sendCommand('Emulation.setUserAgentOverride', firefox
      ? { userAgent: firefoxUserAgent(), platform: navigatorPlatform(false) } // Firefox não tem client hints
      : { userAgent, platform: navigatorPlatform(mobile), userAgentMetadata: uaMetadata(process.versions.chrome, mobile) }).catch(() => {});
  };
  wc.setUserAgent(userAgent); // texto também no nível do Electron (workers, primeiras requisições)
  send();
  wc.on('devtools-closed', send);
  // Entrou/saiu das páginas de login do Google: troca a identificação (antes de a página carregar).
  wc.on('did-start-navigation', (d) => {
    if (!d.isMainFrame || d.isSameDocument) return;
    const want = needsFirefoxIdentity(d.url);
    if (want === firefox) return;
    firefox = want;
    wc.setUserAgent(want ? firefoxUserAgent() : userAgent);
    send();
  });
}
