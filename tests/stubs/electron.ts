// Stub mínimo do Electron para testes unitários. Cada teste ajusta o que precisa.
import { vi } from 'vitest';
import os from 'node:os';

export const app = {
  getPath: vi.fn((_name: string) => os.tmpdir()),
  configureHostResolver: vi.fn(),
  isPackaged: false,
};
export const net = { fetch: vi.fn() };
export const protocol = { registerSchemesAsPrivileged: vi.fn() };
export const session = { fromPartition: vi.fn() };
export class BrowserWindow {}
export class WebContentsView {}
