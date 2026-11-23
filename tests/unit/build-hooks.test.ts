import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../..');
const req = createRequire(join(root, 'package.json'));

describe('assinaturas do build (Windows)', () => {
  // A assinatura de código (Authenticode) altera o .exe e invalidaria a VMP do castLabs feita
  // no after-pack: com certificado, a VMP é refeita depois dela. Ordem: fuses → código → VMP.
  it('afterSign refaz a VMP depois da assinatura de código', () => {
    const build = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build;
    expect(build.afterPack).toBe('scripts/after-pack.cjs');
    expect(build.afterSign).toBe('scripts/after-sign.cjs');
    const afterSign = readFileSync(join(root, 'scripts/after-sign.cjs'), 'utf8');
    expect(afterSign).toMatch(/require\('\.\/after-pack\.cjs'\)/);
    expect(afterSign).toMatch(/vmpSign\(context\)/);
    expect(typeof req('./scripts/after-pack.cjs').vmpSign).toBe('function');
  });

  it('no Linux a VMP não roda (nem no after-sign)', async () => {
    const { default: afterSign } = req('./scripts/after-sign.cjs') as { default: (c: object) => Promise<void> };
    await expect(afterSign({ electronPlatformName: 'linux', appOutDir: '/nao-existe' })).resolves.toBeUndefined();
  });
});
