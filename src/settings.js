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
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Fallback público caso o endereço do Zero Trust Gateway não esteja configurado.
const PUBLIC_DOH = 'https://cloudflare-dns.com/dns-query';

const DEFAULTS = {
  dns: { mode: 'secure', dohUrl: null },
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[apollo] settings.json inválido, usando padrões:', err.message);
  }
  const dns = { ...DEFAULTS.dns, ...user.dns };
  // Variável de ambiente tem prioridade (útil para testes).
  if (process.env.APOLLO_DOH_URL) dns.dohUrl = process.env.APOLLO_DOH_URL;
  return { ...DEFAULTS, ...user, dns };
}

function applyDns(settings) {
  const { mode, dohUrl } = settings.dns;
  if (mode === 'off') return { mode: 'off' };

  const url = dohUrl || PUBLIC_DOH;
  if (!/^https:\/\//.test(url)) {
    console.warn('[apollo] dohUrl precisa começar com https:// — usando DNS público da Cloudflare');
  }
  const server = /^https:\/\//.test(url) ? url : PUBLIC_DOH;
  app.configureHostResolver({
    secureDnsMode: mode === 'automatic' ? 'automatic' : 'secure',
    secureDnsServers: [server],
  });
  return {
    mode,
    provider: server === PUBLIC_DOH ? 'cloudflare-public' : 'custom (zero trust gateway)',
  };
}

module.exports = { loadSettings, applyDns, settingsPath };
