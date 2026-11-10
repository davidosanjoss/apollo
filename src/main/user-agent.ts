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

/** navigator.platform como no Chrome. */
const navigatorPlatform = (mobile: boolean, os = process.platform) =>
  mobile ? 'Linux armv81' : os === 'win32' ? 'Win32' : os === 'darwin' ? 'MacIntel' : 'Linux x86_64';

/**
 * Aplica texto + metadados à página (antes da primeira navegação, de preferência).
 * Se as ferramentas do desenvolvedor tomarem o lugar, reaplica quando fecharem.
 */
export function applyUserAgent(wc: WebContents, userAgent: string, mobile = false): void {
  const send = () => {
    if (wc.isDestroyed()) return;
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    } catch {
      return; // devtools aberto: tenta de novo quando fechar
    }
    void wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent,
      platform: navigatorPlatform(mobile),
      userAgentMetadata: uaMetadata(process.versions.chrome, mobile),
    }).catch(() => {});
  };
  wc.setUserAgent(userAgent); // texto também no nível do Electron (workers, primeiras requisições)
  send();
  wc.on('devtools-closed', send);
}
