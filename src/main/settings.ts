// Configurações locais do usuário. Ficam em <userData>/settings.json,
// FORA do repositório — nada de endereços pessoais/segredos no código.
//
// Exemplo de settings.json:
// {
//   "dns": {
//     "mode": "secure",
//     "dohUrl": "https://SEU-ID.cloudflare-gateway.com/dns-query"
//   }
// }
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Fallback público caso o endereço do Zero Trust Gateway não esteja configurado.
const PUBLIC_DOH = 'https://cloudflare-dns.com/dns-query';

export type DnsMode = 'secure' | 'automatic' | 'off';

export interface Settings {
  dns: { mode: DnsMode; dohUrl: string | null };
}

export interface DnsInfo {
  mode: DnsMode;
  provider?: string;
  resolveOk?: boolean;
  error?: string;
}

export const settingsPath = (): string => path.join(app.getPath('userData'), 'settings.json');

export function loadSettings(): Settings {
  let user: Partial<Settings> = {};
  try {
    user = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[apollo] settings.json inválido, usando padrões:', (err as Error).message);
    }
  }
  const dns = { mode: 'secure' as DnsMode, dohUrl: null as string | null, ...user.dns };
  // Variável de ambiente tem prioridade (útil para testes).
  if (process.env.APOLLO_DOH_URL) dns.dohUrl = process.env.APOLLO_DOH_URL;
  return { dns };
}

/** Endereço DoH aceitável: https, sem credenciais, tamanho razoável. */
export function validDohUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 512) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** Grava as configurações (só leitura/escrita do próprio usuário: o endereço do Gateway é pessoal). */
export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
}

export function applyDns(settings: Settings): DnsInfo {
  const { mode, dohUrl } = settings.dns;
  if (mode === 'off') {
    // Explícito: se o DoH estava ligado nesta execução, volta ao DNS do sistema.
    app.configureHostResolver({ secureDnsMode: 'off' });
    return { mode: 'off' };
  }

  const valid = typeof dohUrl === 'string' && /^https:\/\//.test(dohUrl);
  if (dohUrl && !valid) console.warn('[apollo] dohUrl precisa começar com https:// — usando DNS público da Cloudflare');
  const server = valid ? dohUrl : PUBLIC_DOH;

  app.configureHostResolver({
    secureDnsMode: mode === 'automatic' ? 'automatic' : 'secure',
    secureDnsServers: [server],
  });
  return { mode, provider: server === PUBLIC_DOH ? 'cloudflare-public' : 'custom (zero trust gateway)' };
}
