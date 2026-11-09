// Modelo de menu nativo, puro (testável). O Browser converte em menu do Electron:
// menus nativos ficam por cima da página (um menu em HTML ficaria atrás dela).
import type { UiCommand } from '../shared/types';

export type MenuModelItem =
  | { kind: 'info'; label: string }
  | { kind: 'separator' }
  | { kind: 'check'; label: string; checked: boolean; enabled: boolean; command: UiCommand }
  | { kind: 'radio'; label: string; checked: boolean; command: UiCommand }
  | { kind: 'action'; label: string; enabled: boolean; command: UiCommand }
  | { kind: 'submenu'; label: string; items: MenuModelItem[] };
