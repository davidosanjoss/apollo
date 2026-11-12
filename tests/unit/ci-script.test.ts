import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('scripts/ci-e2e.sh', () => {
  // Regressão: apt-get install sem update antes usava a lista de pacotes velha do
  // runner; o espelho do Ubuntu respondia 404 e derrubava o release da v0.9.1.
  it('atualiza a lista de pacotes antes de instalar', () => {
    const script = readFileSync(join(__dirname, '../../scripts/ci-e2e.sh'), 'utf8');
    const update = script.indexOf('apt-get update');
    const install = script.indexOf('apt-get install');
    expect(install).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(update).toBeLessThan(install);
  });
});
