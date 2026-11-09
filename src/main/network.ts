import type {
  Session,
  OnBeforeRequestListenerDetails,
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
} from 'electron';

/**
 * Pipeline de rede central.
 *
 * O Electron aceita UM listener por evento de webRequest por sessão. Bloqueador,
 * cookies de terceiros, limpeza de URL, GPC etc. são módulos que se plugam aqui.
 * Um hook só é registrado se algum módulo o usa: sem módulos, zero custo por requisição.
 */

export interface RequestContext {
  workspaceId: string;
  /** Aba de origem; null para service workers, popups e requisições do próprio navegador. */
  tabId: string | null;
}

export type Headers = Record<string, string | string[]>;

export interface NetworkModule {
  readonly name: string;
  onBeforeRequest?(details: OnBeforeRequestListenerDetails, ctx: RequestContext): { cancel?: boolean; redirectURL?: string } | void;
  /** Recebe e devolve os cabeçalhos da requisição (pode mutar). */
  onBeforeSendHeaders?(details: OnBeforeSendHeadersListenerDetails, headers: Record<string, string>, ctx: RequestContext): void;
  /** Recebe e devolve os cabeçalhos da resposta (pode mutar). */
  onHeadersReceived?(details: OnHeadersReceivedListenerDetails, headers: Headers, ctx: RequestContext): void;
}

export class NetworkPipeline {
  constructor(
    private readonly modules: NetworkModule[],
    private readonly resolveTab: (webContentsId: number | undefined) => string | null,
  ) {}

  private run<T>(module: NetworkModule, hook: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      // Um módulo com bug nunca pode quebrar a navegação.
      console.warn(`[apollo:net] módulo ${module.name}.${hook} falhou:`, err);
      return undefined;
    }
  }

  attach(ses: Session, workspaceId: string): void {
    const ctxFor = (webContentsId: number | undefined): RequestContext => ({
      workspaceId,
      tabId: this.resolveTab(webContentsId),
    });

    const before = this.modules.filter((m) => m.onBeforeRequest);
    if (before.length) {
      ses.webRequest.onBeforeRequest((details, callback) => {
        const ctx = ctxFor(details.webContentsId);
        for (const m of before) {
          const r = this.run(m, 'onBeforeRequest', () => m.onBeforeRequest!(details, ctx));
          if (r && (r.cancel || r.redirectURL)) return callback(r);
        }
        callback({});
      });
    }

    const send = this.modules.filter((m) => m.onBeforeSendHeaders);
    if (send.length) {
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const ctx = ctxFor(details.webContentsId);
        const headers = { ...details.requestHeaders };
        for (const m of send) this.run(m, 'onBeforeSendHeaders', () => m.onBeforeSendHeaders!(details, headers, ctx));
        callback({ requestHeaders: headers });
      });
    }

    const received = this.modules.filter((m) => m.onHeadersReceived);
    if (received.length) {
      ses.webRequest.onHeadersReceived((details, callback) => {
        const ctx = ctxFor(details.webContentsId);
        const headers: Headers = { ...(details.responseHeaders ?? {}) };
        for (const m of received) this.run(m, 'onHeadersReceived', () => m.onHeadersReceived!(details, headers, ctx));
        callback({ responseHeaders: headers });
      });
    }
  }
}

// ------------------------------------------------------------ módulos

/** Global Privacy Control: pede aos sites para não venderem/compartilharem seus dados. */
export const gpcModule: NetworkModule = {
  name: 'gpc',
  onBeforeSendHeaders(_details, headers) {
    headers['Sec-GPC'] = '1';
  },
};
