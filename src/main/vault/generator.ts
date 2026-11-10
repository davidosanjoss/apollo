// Gerador de senhas (aleatoriedade criptográfica, sem viés de módulo).
import crypto from 'node:crypto';

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Sem caracteres que se confundem (0/O, 1/l/I). */
  avoidAmbiguous: boolean;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  length: 20, uppercase: true, lowercase: true, digits: true, symbols: true, avoidAmbiguous: true,
};


const SETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*-_=+?.,:;',
};
const AMBIGUOUS = /[0O1lI]/g;

export function generatePassword(opts: GeneratorOptions = DEFAULT_GENERATOR): string {
  const length = Math.min(Math.max(Math.trunc(opts.length) || 0, 8), 128);
  const pools = (Object.keys(SETS) as (keyof typeof SETS)[])
    .filter((k) => opts[k])
    .map((k) => (opts.avoidAmbiguous ? SETS[k].replace(AMBIGUOUS, '') : SETS[k]));
  if (pools.length === 0) pools.push(SETS.lowercase);
  // Um de cada classe escolhida (sites costumam exigir), o resto de todas, embaralhado.
  const all = pools.join('');
  const chars = pools.map((p) => p[crypto.randomInt(p.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
