import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('aceleração de vídeo no Linux', () => {
  // Regressão (relatado): no Teams, quem via o compartilhamento de tela via tudo preto. O
  // H.264 codificado por VA-API (AMD/Mesa) saía em quadros que o outro lado não decodificava
  // (medido: 9 codificados, 0 decodificados). A decodificação por hardware pode continuar.
  it('não liga a codificação de vídeo por hardware', () => {
    const src = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*'AcceleratedVideoEncoder',/m);
    expect(src).toContain("'AcceleratedVideoDecodeLinuxGL'");
  });
});
