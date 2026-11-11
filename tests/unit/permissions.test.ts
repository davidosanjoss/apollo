import type { Session, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionManager, SITE_PANEL_KINDS, originOf } from '../../src/main/permissions';
import type { Store } from '../../src/main/store';
import { memoryStore } from '../helpers';

type RequestHandler = (wc: WebContents | null, permission: string, cb: (granted: boolean) => void, details: object) => void;
type CheckHandler = (wc: WebContents | null, permission: string, origin: string, details: object) => boolean;

function fakeSession() {
  const h: { request?: RequestHandler; check?: CheckHandler } = {};
  const ses = {
    setPermissionRequestHandler: (fn: RequestHandler) => { h.request = fn; },
    setPermissionCheckHandler: (fn: CheckHandler) => { h.check = fn; },
  } as unknown as Session;
  return { ses, h };
}

const TAB_WC = { id: 1 } as unknown as WebContents;
const PANEL_WC = { id: 2 } as unknown as WebContents;
const POPUP_WC = { id: 2 } as unknown as WebContents;
const SITE = 'https://site.com';

let store: Store;
let pm: PermissionManager;
let onChange: ReturnType<typeof vi.fn<() => void>>;
let h: ReturnType<typeof fakeSession>['h'];

/** Faz um pedido e devolve a resposta (ou 'pendente' se virou pergunta). */
function request(permission: string, details: object = {}, wc: WebContents | null = TAB_WC) {
  let result: boolean | 'pendente' = 'pendente';
  h.request!(wc, permission, (g) => { result = g; }, { requestingUrl: `${SITE}/pagina`, ...details });
  return { get value() { return result; } };
}

beforeEach(() => {
  store = memoryStore();
  store.createWorkspace({ id: 'w', name: 'W', color: '#000000', home: '' });
  store.createWorkspace({ id: 'outro', name: 'O', color: '#000000', home: '' });
  onChange = vi.fn<() => void>();
  pm = new PermissionManager(store, (wc) => (wc === TAB_WC ? 'tab1' : null), onChange, (wc) => (wc === PANEL_WC ? 'p1' : null));
  const fake = fakeSession();
  h = fake.h;
  pm.attach(fake.ses, 'w');
});

describe('originOf', () => {
  it('extrai a origem e rejeita URLs opacas/inválidas', () => {
    expect(originOf('https://a.com:8443/x?y#z')).toBe('https://a.com:8443');
    expect(originOf('data:text/html,oi')).toBeNull();
    expect(originOf('não é url')).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf(null)).toBeNull();
  });
});

describe('pedidos de permissão', () => {
  it('libera as inofensivas (tela cheia, DRM) sem perguntar', () => {
    expect(request('fullscreen').value).toBe(true);
    expect(request('mediaKeySystem').value).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Compartilhar tela passa para o seletor do Apollo (que é onde o usuário consente).
  it('compartilhar tela segue para o seletor (não é negado aqui)', () => {
    expect(request('display-capture').value).toBe(true);
    expect(h.check!(TAB_WC, 'display-capture', SITE, {})).toBe(true);
  });

  it('nega o que não é conhecido (sistema de arquivos…)', () => {
    for (const p of ['fileSystem', 'idle-detection', 'window-management', 'inventada']) {
      expect(request(p).value, p).toBe(false);
    }
  });

  it('sensível sem decisão salva vira pergunta para a aba', () => {
    const r = request('geolocation');
    expect(r.value).toBe('pendente');
    expect(onChange).toHaveBeenCalled();
    expect(pm.promptFor('tab1')).toMatchObject({ tabId: 'tab1', origin: SITE, kinds: ['geolocation'] });
    expect(pm.promptFor('outra-aba')).toBeNull();
  });

  it('popup (sem aba) não pode perguntar: negado', () => {
    expect(request('geolocation', {}, POPUP_WC).value).toBe(false);
  });

  it('origem inválida: negado', () => {
    expect(request('geolocation', { requestingUrl: 'data:text/html,x' }).value).toBe(false);
  });

  it('permitir com "lembrar" grava; o próximo pedido nem pergunta', () => {
    const r = request('geolocation');
    pm.answer(pm.promptFor('tab1')!.id, 'allow', true);
    expect(r.value).toBe(true);
    expect(pm.promptFor('tab1')).toBeNull();
    expect(store.getPermission('w', SITE, 'geolocation')).toBe('allow');
    expect(request('geolocation').value).toBe(true);
  });

  it('bloquear sem "lembrar" vale só desta vez', () => {
    const r = request('geolocation');
    pm.answer(pm.promptFor('tab1')!.id, 'deny', false);
    expect(r.value).toBe(false);
    expect(store.getPermission('w', SITE, 'geolocation')).toBeNull();
    expect(request('geolocation').value).toBe('pendente');
  });

  // Regressão: "Permitir" sem "Lembrar" liberava o pedido, mas a checagem logo depois
  // dizia "não" — new Notification() falhava mesmo depois de o usuário permitir.
  it('permitir sem "lembrar" vale nesta execução (pedido e checagem), sem salvar', () => {
    const r = request('notifications');
    pm.answer(pm.promptFor('tab1')!.id, 'allow', false);
    expect(r.value).toBe(true);
    expect(store.getPermission('w', SITE, 'notifications')).toBeNull();
    expect(h.check!(TAB_WC, 'notifications', SITE, {})).toBe(true);
    expect(request('notifications').value).toBe(true); // não pergunta de novo
    expect(pm.notificationState('w', SITE)).toBe('allow');
    expect(pm.notificationState('outro', SITE)).toBe('ask');
    pm.set('w', SITE, 'notifications', 'deny'); // escolha explícita no painel do site vale
    expect(h.check!(TAB_WC, 'notifications', SITE, {})).toBe(false);
    expect(pm.notificationState('w', SITE)).toBe('deny');
  });

  it('estado das notificações: perguntar / permitir / bloquear', () => {
    expect(pm.notificationState('w', SITE)).toBe('ask');
    store.setPermission('w', SITE, 'notifications', 'allow');
    expect(pm.notificationState('w', SITE)).toBe('allow');
    store.setPermission('w', SITE, 'notifications', 'deny');
    expect(pm.notificationState('w', SITE)).toBe('deny');
  });

  it('decisão é do workspace: outro workspace não herda', () => {
    store.setPermission('outro', SITE, 'geolocation', 'allow');
    expect(request('geolocation').value).toBe('pendente');
  });

  it('câmera + microfone: um "bloquear" salvo nega tudo; ambos "permitir" libera', () => {
    store.setPermission('w', SITE, 'media-video', 'allow');
    store.setPermission('w', SITE, 'media-audio', 'deny');
    expect(request('media', { mediaTypes: ['video', 'audio'] }).value).toBe(false);
    store.setPermission('w', SITE, 'media-audio', 'allow');
    expect(request('media', { mediaTypes: ['video', 'audio'] }).value).toBe(true);
  });

  it('pedido só de microfone pergunta só o microfone', () => {
    request('media', { mediaTypes: ['audio'] });
    expect(pm.promptFor('tab1')!.kinds).toEqual(['media-audio']);
  });

  it('fechar/navegar a aba nega os pedidos pendentes dela', () => {
    const r = request('geolocation');
    pm.cancelForTab('tab1');
    expect(r.value).toBe(false);
    expect(pm.promptFor('tab1')).toBeNull();
  });

  it('resposta para pedido inexistente é ignorada', () => {
    pm.answer('nao-existe', 'allow', true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('verificação síncrona (permission check)', () => {
  it('só responde "sim" se já foi permitido explicitamente', () => {
    expect(h.check!(TAB_WC, 'notifications', SITE, {})).toBe(false);
    store.setPermission('w', SITE, 'notifications', 'allow');
    expect(h.check!(TAB_WC, 'notifications', SITE, {})).toBe(true);
    expect(h.check!(TAB_WC, 'fullscreen', SITE, {})).toBe(true);
    expect(h.check!(TAB_WC, 'window-management', SITE, {})).toBe(false);
  });

  it('mídia: mediaType "unknown" exige câmera e microfone', () => {
    store.setPermission('w', SITE, 'media-video', 'allow');
    expect(h.check!(TAB_WC, 'media', SITE, { mediaType: 'video' })).toBe(true);
    expect(h.check!(TAB_WC, 'media', SITE, { mediaType: 'unknown' })).toBe(false);
  });
});

describe('painel do site', () => {
  it('lista as permissões ajustáveis com a decisão atual', () => {
    pm.set('w', SITE, 'notifications', 'allow');
    const info = pm.siteInfo('w', `${SITE}/inbox`)!;
    expect(info.origin).toBe(SITE);
    expect(info.entries.map((e) => e.kind)).toEqual(SITE_PANEL_KINDS);
    expect(info.entries.find((e) => e.kind === 'notifications')!.decision).toBe('allow');
    expect(info.entries.find((e) => e.kind === 'geolocation')!.decision).toBeNull();
  });

  it('não aparece em páginas internas', () => {
    expect(pm.siteInfo('w', 'apollo://home')).toBeNull();
    expect(pm.siteInfo('w', null)).toBeNull();
  });
});

// Pedido do usuário: câmera e microfone no WhatsApp/Teams dos painéis (antes, negado direto).
describe('pedidos de painéis', () => {
  it('painel pergunta na barra (com o painel aberto); a aba ativa tem prioridade', () => {
    const r = request('media', { mediaTypes: ['video', 'audio'] }, PANEL_WC);
    expect(r.value).toBe('pendente');
    expect(pm.promptFor(null, 'p1')).toMatchObject({ tabId: null, panelId: 'p1', kinds: ['media-video', 'media-audio'] });
    expect(pm.promptFor('tab1', null)).toBeNull(); // painel fechado: não aparece
    request('geolocation');
    expect(pm.promptFor('tab1', 'p1')?.tabId).toBe('tab1');
    pm.answer(pm.promptFor(null, 'p1')!.id, 'allow', true);
    expect(r.value).toBe(true);
    expect(store.getPermission('w', SITE, 'media-video')).toBe('allow');
  });

  it('fechar o painel nega o pedido pendente; popup (nem aba nem painel) continua negado', () => {
    const r = request('media', { mediaTypes: ['audio'] }, PANEL_WC);
    pm.cancelForPanel('p1');
    expect(r.value).toBe(false);
    expect(request('media', { mediaTypes: ['audio'] }, { id: 9 } as unknown as WebContents).value).toBe(false);
  });
});
