// Gera o ícone do Apollo (um sol de raios ondulados): assets/icon.svg e os PNGs dos
// instaladores. Determinístico (mesma saída sempre). Requer rsvg-convert para os PNGs.
//   node scripts/make-icon.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const S = 512, C = S / 2;
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

/** Um raio: linha central ondulada, afinando até a ponta. */
function ray(angle, start, length, width, amp, phase) {
  const n = 28, left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = start + t * length;
    const off = amp * Math.sin(t * Math.PI * 1.7 + phase) * (0.35 + 0.65 * t); // onda cresce para fora
    const w = width * Math.pow(1 - t, 0.75) * 0.5 + 0.4;
    const a = angle, ca = Math.cos(a), sa = Math.sin(a);
    // eixo do raio (ca, sa); perpendicular (-sa, ca)
    const cx = C + d * ca - off * sa, cy = C + d * sa + off * ca;
    left.push([cx - w * sa, cy + w * ca]);
    right.push([cx + w * sa, cy - w * ca]);
  }
  const pts = [...left, ...right.reverse()];
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + 'Z';
}

const N = 16, rays = [];
for (let i = 0; i < N; i++) {
  const long = i % 2 === 0;
  const angle = ((i / N) * 360 + 8 + (rand() - 0.5) * 7) * Math.PI / 180;
  const length = (long ? 128 : 90) * (0.92 + rand() * 0.14); // cabe no quadro com folga
  rays.push(ray(angle, 102, length, long ? 34 : 26, long ? 13 : 9, rand() * Math.PI));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="raio" cx="50%" cy="50%" r="50%">
      <stop offset="0.35" stop-color="#ffbe55"/><stop offset="1" stop-color="#e8862c"/>
    </radialGradient>
    <radialGradient id="disco" cx="42%" cy="38%" r="70%">
      <stop offset="0" stop-color="#ffd27a"/><stop offset="0.55" stop-color="#f7a640"/><stop offset="1" stop-color="#e48a2f"/>
    </radialGradient>
  </defs>
  <g fill="url(#raio)">
${rays.map((d) => `    <path d="${d}"/>`).join('\n')}
  </g>
  <circle cx="${C}" cy="${C}" r="94" fill="url(#disco)"/>
</svg>
`;
fs.mkdirSync('assets', { recursive: true });
fs.writeFileSync('assets/icon.svg', svg);
for (const size of [512, 256, 128, 64, 32, 16]) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), 'assets/icon.svg', '-o', `assets/icon-${size}.png`]);
}
fs.copyFileSync('assets/icon-512.png', 'assets/icon.png');
console.log('ícone gerado em assets/');
