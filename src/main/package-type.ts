// Como o Apollo foi instalado. Pacotes de distribuição (AUR) gravam resources/package-type;
// aí quem atualiza é o gerenciador de pacotes, e a entrada .desktop é a do pacote.
import fs from 'node:fs';
import path from 'node:path';

export type PackageType = 'aur' | null;

export function packageType(resourcesPath = process.resourcesPath): PackageType {
  if (process.env.APOLLO_TEST_PACKAGE_TYPE === 'aur') return 'aur'; // testes de integração
  try {
    return fs.readFileSync(path.join(resourcesPath ?? '', 'package-type'), 'utf8').trim() === 'aur' ? 'aur' : null;
  } catch {
    return null;
  }
}

/** Entrada .desktop instalada pelo pacote do AUR. */
export const AUR_DESKTOP_FILE = 'apollo-browser.desktop';
