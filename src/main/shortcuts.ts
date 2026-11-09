// Atalhos de teclado do navegador. Funcionam com o foco em qualquer aba ou na UI.
// Só depende do formato de `Input` do Electron, para ser testável sem Electron.
export interface KeyInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export type ShortcutAction =
  | 'new-tab' | 'close-tab' | 'focus-address' | 'reload' | 'back' | 'forward'
  | 'next-tab' | 'prev-tab' | `workspace-${number}`;

export function shortcutFor(input: KeyInput): ShortcutAction | null {
  if (input.type !== 'keyDown') return null;
  const mod = input.control || input.meta;
  const k = input.key.toLowerCase();
  if (mod && !input.shift && k === 't') return 'new-tab';
  if (mod && !input.shift && k === 'w') return 'close-tab';
  if (mod && !input.shift && k === 'l') return 'focus-address';
  if ((mod && k === 'r') || input.key === 'F5') return 'reload';
  if (mod && input.key === 'Tab') return input.shift ? 'prev-tab' : 'next-tab';
  if (input.alt && input.key === 'ArrowLeft') return 'back';
  if (input.alt && input.key === 'ArrowRight') return 'forward';
  if (mod && /^[1-9]$/.test(input.key)) return `workspace-${Number(input.key)}`;
  return null;
}
