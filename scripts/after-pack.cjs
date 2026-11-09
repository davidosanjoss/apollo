// Executado pelo electron-builder depois de empacotar e antes de gerar os instaladores.
//
// 1. Fuses do Electron: desligam recursos que transformariam o binário do Apollo
//    num executor de código arbitrário, e ligam a criptografia de cookies.
// 2. Assinatura VMP do castLabs (DRM no Windows). Precisa vir DEPOIS dos fuses,
//    porque os fuses alteram o binário e invalidariam a assinatura.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

function binaryPath(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName === 'win32') return path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  if (electronPlatformName === 'linux') return path.join(appOutDir, packager.executableName);
  throw new Error(`plataforma não suportada: ${electronPlatformName}`);
}

async function applyFuses(context) {
  const file = binaryPath(context);
  await flipFuses(file, {
    version: FuseVersion.V1,
    // ELECTRON_RUN_AS_NODE=1 transformaria o Apollo num Node.js qualquer.
    [FuseV1Options.RunAsNode]: false,
    // NODE_OPTIONS e --inspect permitiriam injetar código ou depurador.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // Cookies cifrados com chave do chaveiro do sistema (libsecret/KWallet, DPAPI no Windows).
    [FuseV1Options.EnableCookieEncryption]: true,
    // Só carrega o app de dentro do app.asar (ignora pastas "app" plantadas ao lado).
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // file:// sem privilégios extras: a UI é servida por apollo://, não por file://.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`[after-pack] fuses aplicados em ${path.basename(file)}`);
}

function vmpSign(context) {
  // VMP é exigido no Windows/macOS para serviços com DRM exigente (Netflix, Prime, Disney+).
  // Requer conta gratuita no castLabs EVS:
  //   pip install --upgrade castlabs-evs && python -m castlabs_evs.account signup
  if (context.electronPlatformName === 'linux') return;
  const python = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  } catch {
    console.warn('[after-pack] castLabs EVS indisponível — build SEM assinatura VMP (DRM limitado no Windows).');
  }
}

exports.default = async function afterPack(context) {
  await applyFuses(context);
  vmpSign(context);
};
