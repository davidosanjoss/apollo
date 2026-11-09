// Assinatura VMP (Verified Media Path) do castLabs.
// Necessária no Windows/macOS para serviços com DRM exigente (Netflix, Prime, Disney+).
// No Linux não é exigida. Requer conta gratuita no castLabs EVS:
//   pip install --upgrade castlabs-evs && python -m castlabs_evs.account signup
// Se o EVS não estiver disponível, o build segue sem assinatura (aviso no log).
const { execFileSync } = require('node:child_process');

exports.default = async function vmpSign(context) {
  if (context.electronPlatformName === 'linux') return;
  const python = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  } catch {
    console.warn('[vmp-sign] castLabs EVS indisponível — build SEM assinatura VMP (DRM limitado no Windows).');
  }
};
