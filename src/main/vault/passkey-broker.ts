// Pedidos de passkey das abas: um por aba, à espera da escolha na janela do Apollo
// (entrar com qual passkey / salvar onde). O login "condicional" (o site espera sem janela,
// como no preenchimento automático) fica guardado até o usuário escolher no menu da chave.
import crypto from 'node:crypto';
import type { PasskeyPromptInfo } from '../../shared/types';
import {
  alreadyRegistered, assertionResponse, attestationResponse, candidatesFor, notAllowed, parseRequest,
  type Candidate, type CreateRequest, type GetRequest, type PasskeyResponse,
} from './passkeys';
import type { NewPasskey, UnlockedVault, VaultLogin } from './vault';
import { acceptsEs256, credentialIdBytes, credentialIdStored, effectiveRpId, makeAssertion, makeAttestation } from './webauthn';

export interface PasskeyDeps {
  status(): 'disconnected' | 'locked' | 'unlocked';
  vault(): UnlockedVault | null;
  /** Logins do cofre que casam com a URL (mesma regra do preenchimento). */
  loginsFor(url: string): VaultLogin[];
  saveNew(name: string, uri: string, passkey: NewPasskey): Promise<boolean | null>;
  saveTo(itemId: string, passkey: NewPasskey): Promise<boolean | null>;
  updateCounter(itemId: string, credentialId: string, counter: number): Promise<unknown>;
  onChange(): void;
  /** Windows: dá para entregar ao Windows Hello / chave de segurança. */
  canFallback: boolean;
}

interface Pending {
  id: string;
  tabId: string;
  reqId: number;
  origin: string;
  rpId: string;
  req: CreateRequest | GetRequest;
  resolve: (r: PasskeyResponse) => void;
  busy: boolean;
  error: string | null;
  timer: NodeJS.Timeout;
}

/** Tempo máximo à espera de uma resposta (a janela some e o site recebe "cancelado"). */
const PROMPT_TIMEOUT_MS = 5 * 60_000;

const optionId = (itemId: string, credentialId: string) =>
  crypto.createHash('sha256').update(`${itemId}\n${credentialId}`).digest('hex').slice(0, 24);

export class PasskeyBroker {
  private readonly prompts = new Map<string, Pending>();
  private readonly conditional = new Map<string, Pending>();

  constructor(private readonly deps: PasskeyDeps) {}

  /** Pedido da página (texto do preload). `origin` é a do frame, conferida pelo processo principal. */
  request(tabId: string, origin: string, raw: unknown): Promise<PasskeyResponse> {
    const req = parseRequest(raw);
    if (!req) return Promise.resolve({ error: 'NotAllowedError', message: 'Pedido de passkey inválido.' });
    const rpId = effectiveRpId(origin, req.rpId);
    if (!rpId) return Promise.resolve({ error: 'SecurityError', message: 'Este site não pode usar passkeys deste domínio.' });
    if (req.kind === 'create' && !acceptsEs256(req.algs)) {
      return Promise.resolve(this.deps.canFallback ? { fallback: true } : { error: 'NotSupportedError', message: 'O site não aceita o tipo de chave do Bitwarden.' });
    }
    return new Promise((resolve) => {
      const p: Pending = { id: crypto.randomUUID(), tabId, reqId: req.id, origin, rpId, req, resolve, busy: false, error: null,
        timer: setTimeout(() => this.finish(p, notAllowed('O tempo para escolher acabou.')), PROMPT_TIMEOUT_MS) };
      p.timer.unref?.();
      if (req.kind === 'get' && req.conditional) {
        const old = this.conditional.get(tabId);
        if (old) this.finish(old, { error: 'AbortError', message: 'Substituído por um pedido novo.' });
        this.conditional.set(tabId, p);
        return;
      }
      const busy = [...this.prompts.values()].find((x) => x.tabId === tabId);
      if (busy) { clearTimeout(p.timer); resolve(notAllowed('Já há um pedido de passkey aberto nesta aba.')); return; }
      this.prompts.set(p.id, p);
      this.deps.onChange();
    });
  }

  /** O site desistiu (AbortSignal). */
  cancel(tabId: string, reqId: unknown): void {
    for (const p of [...this.prompts.values(), ...this.conditional.values()]) {
      if (p.tabId === tabId && p.reqId === reqId) this.finish(p, { error: 'AbortError', message: 'A operação foi abortada.' });
    }
  }

  /** A aba navegou ou fechou: tudo dela é cancelado. */
  cancelTab(tabId: string): void {
    for (const p of [...this.prompts.values(), ...this.conditional.values()]) if (p.tabId === tabId) this.finish(p, notAllowed());
  }

  private finish(p: Pending, r: PasskeyResponse): void {
    clearTimeout(p.timer);
    const had = this.prompts.delete(p.id);
    if (this.conditional.get(p.tabId) === p) this.conditional.delete(p.tabId);
    p.resolve(r);
    if (had) this.deps.onChange();
  }

  private candidates(p: Pending): Candidate[] {
    const v = this.deps.vault();
    return v && p.req.kind === 'get' ? candidatesFor(v.logins, p.rpId, p.req.allow) : [];
  }

  /** Janela da aba (só a da aba ativa é mostrada). */
  promptFor(tabId: string | null): PasskeyPromptInfo | null {
    const p = tabId ? [...this.prompts.values()].find((x) => x.tabId === tabId) : undefined;
    if (!p) return null;
    const vault = this.deps.status();
    const base = { id: p.id, kind: p.req.kind, site: p.rpId, vault, canFallback: this.deps.canFallback, busy: p.busy, error: p.error };
    if (p.req.kind === 'get') {
      const options = this.candidates(p).map((c) => ({ id: optionId(c.itemId, c.passkey.credentialId),
        label: c.passkey.userName || c.passkey.userDisplayName || c.itemName, detail: c.itemName, replaces: false }));
      const message = vault === 'unlocked' && !options.length ? `Nenhuma passkey de ${p.rpId} no Bitwarden.` : null;
      return { ...base, options, userName: null, message };
    }
    const v = this.deps.vault();
    const exists = v ? alreadyRegistered(v.logins, p.rpId, p.req.exclude) : false;
    const targets = v ? this.deps.loginsFor(p.origin) : [];
    const options = [
      { id: 'new', label: 'Login novo', detail: p.rpId, replaces: false },
      ...targets.map((l) => ({ id: l.id, label: l.username ? `${l.name} — ${l.username}` : l.name, detail: l.passkeys.length ? 'já tem uma passkey (será trocada)' : null, replaces: l.passkeys.length > 0 })),
    ];
    return { ...base, options: vault === 'unlocked' && !exists ? options : [], userName: p.req.userName || p.req.userDisplayName,
      message: exists ? `Você já tem uma passkey de ${p.rpId} no Bitwarden.` : null };
  }

  /** Escolha na janela: opção (passkey ou onde salvar), cancelar (null) ou outro método. */
  async answer(promptId: string, choice: string | null, fallback = false): Promise<void> {
    const p = this.prompts.get(promptId);
    if (!p || p.busy) return;
    if (fallback) return this.finish(p, this.deps.canFallback ? { fallback: true } : notAllowed());
    if (choice === null) {
      // Já registrada (excludeCredentials): o site fica sabendo, como no Chrome ("já existe").
      const v = this.deps.vault();
      if (p.req.kind === 'create' && v && alreadyRegistered(v.logins, p.rpId, p.req.exclude)) {
        return this.finish(p, { error: 'InvalidStateError', message: 'A passkey já está registrada.' });
      }
      return this.finish(p, notAllowed());
    }
    if (p.req.kind === 'get') {
      const c = this.candidates(p).find((x) => optionId(x.itemId, x.passkey.credentialId) === choice);
      if (!c) return;
      const r = this.sign(p, c);
      return this.finish(p, r);
    }
    const v = this.deps.vault();
    if (!v || this.deps.status() !== 'unlocked') return;
    if (alreadyRegistered(v.logins, p.rpId, p.req.exclude)) {
      return this.finish(p, { error: 'InvalidStateError', message: 'A passkey já está registrada.' });
    }
    const target = choice === 'new' ? null : this.deps.loginsFor(p.origin).find((l) => l.id === choice);
    if (choice !== 'new' && !target) return;
    await this.create(p, p.req, target?.id ?? null);
  }

  private sign(p: Pending, c: Candidate): PasskeyResponse {
    const secret = this.deps.vault()?.passkeySecret(c.itemId, c.passkey.credentialId);
    if (!secret) return notAllowed('Não foi possível ler a passkey no Bitwarden.');
    try {
      // Como o Bitwarden: contador 0 fica 0 (passkey sincronizada); os outros sobem.
      const counter = c.passkey.counter > 0 ? c.passkey.counter + 1 : 0;
      const a = makeAssertion({ privateKeyPkcs8: secret.privateKey, credentialId: credentialIdBytes(c.passkey.credentialId),
        userHandle: secret.userHandle, rpId: p.rpId, origin: p.origin, challenge: p.req.challenge, counter, uv: true });
      if (counter > 0) void this.deps.updateCounter(c.itemId, c.passkey.credentialId, counter).catch(() => {});
      return assertionResponse(a);
    } catch {
      return notAllowed('Não foi possível usar a passkey.');
    } finally {
      secret.privateKey.fill(0);
    }
  }

  private async create(p: Pending, req: CreateRequest, itemId: string | null): Promise<void> {
    p.busy = true;
    p.error = null;
    this.deps.onChange();
    const att = makeAttestation({ rpId: p.rpId, origin: p.origin, challenge: req.challenge, uv: true });
    const passkey: NewPasskey = {
      credentialId: credentialIdStored(att.credentialId), privateKey: att.privateKeyPkcs8, rpId: p.rpId, rpName: req.rpName,
      userHandle: req.userId, userName: req.userName, userDisplayName: req.userDisplayName, discoverable: req.residentKey,
    };
    let ok: boolean | null = null;
    try {
      ok = itemId ? await this.deps.saveTo(itemId, passkey) : await this.deps.saveNew(p.rpId, p.origin, passkey);
    } catch { ok = null; }
    passkey.privateKey.fill(0);
    if (!this.prompts.has(p.id)) return; // cancelado enquanto salvava
    if (!ok) {
      p.busy = false;
      p.error = 'Não foi possível salvar a passkey no Bitwarden. Tente de novo.';
      this.deps.onChange();
      return;
    }
    this.finish(p, attestationResponse(att, req.residentKey));
  }

  /** Menu da chave: passkeys para o login "condicional" que a aba está esperando. */
  conditionalOptions(tabId: string | null): { id: string; label: string }[] {
    const p = tabId ? this.conditional.get(tabId) : undefined;
    if (!p) return [];
    return this.candidates(p).map((c) => ({ id: optionId(c.itemId, c.passkey.credentialId), label: c.passkey.userName || c.itemName }));
  }

  useConditional(tabId: string, optionKey: string): void {
    const p = this.conditional.get(tabId);
    const c = p && this.candidates(p).find((x) => optionId(x.itemId, x.passkey.credentialId) === optionKey);
    if (p && c) this.finish(p, this.sign(p, c));
  }
}
