import { net, protocol, type Session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Páginas internas: apollo://<página>/<arquivo> → build/pages/<página>/<arquivo>
//   apollo://ui     interface do navegador
//   apollo://home   página inicial
//   apollo://error  página de erro de carregamento
const PAGES_DIR = path.join(__dirname, 'pages');

export const UI_URL = 'apollo://ui/index.html';

/** Precisa ser chamado antes do app ficar pronto. */
export function registerApolloScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'apollo', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

function handle(request: Request): Promise<Response> | Response {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PAGES_DIR, url.hostname, rel));
  // Bloqueia path traversal (apollo://home/../../main.js)
  if (!file.startsWith(PAGES_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response('Página não encontrada', { status: 404 });
  }
  return net.fetch(pathToFileURL(file).toString());
}

export function serveApolloScheme(ses: Session): void {
  if (!ses.protocol.isProtocolHandled('apollo')) ses.protocol.handle('apollo', handle);
}
