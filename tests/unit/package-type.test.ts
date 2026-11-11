import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageType } from '../../src/main/package-type';

describe('como o Apollo foi instalado', () => {
  it('resources/package-type = "aur" → AUR; sem o arquivo ou outro valor → null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-pt-'));
    try {
      expect(packageType(dir)).toBeNull();
      fs.writeFileSync(path.join(dir, 'package-type'), 'aur\n');
      expect(packageType(dir)).toBe('aur');
      fs.writeFileSync(path.join(dir, 'package-type'), 'deb');
      expect(packageType(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
