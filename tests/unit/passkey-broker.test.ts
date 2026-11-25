import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encrypt, makeAccountKeys, makeMasterKey } from '../../src/main/vault/crypto';
import { PasskeyBroker, type PasskeyDeps } from '../../src/main/vault/passkey-broker';
import { parseRequest } from '../../src/main/vault/passkeys';
import { UnlockedVault, type NewPasskey } from '../../src/main/vault/vault';

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const challenge = crypto.randomBytes(32);
const getReq = (over: object = {}) => JSON.stringify({ id: 1, kind: 'get', rpId: 'exemplo.com', challenge: b64(challenge), allow: [], ...over });
const createReq = (over: object = {}) => JSON.stringify({ id: 2, kind: 'create', rpId: 'exemplo.com', rpName: 'Exemplo', userId: b64('u-1'),
  userName: 'eu@exemplo.com', userDisplayName: 'Eu', challenge: b64(challenge), algs: [-7, -257], exclude: [], residentKey: true, ...over });
const GUID = '11111111-2222-4333-8444-555555555555';

async function setup(status: 'locked' | 'unlocked' = 'unlocked', canFallback = false) {
  const masterKey = await makeMasterKey('senha', 'a@b.c', { type: 0, iterations: 5000 });
  const acc = makeAccountKeys(masterKey);
  const uk = acc.userKey;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const e = (v: string) => encrypt(v, uk);
  const fido = { credentialId: e(GUID), keyType: e('public-key'), keyAlgorithm: e('ECDSA'), keyCurve: e('P-256'),
    keyValue: e(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')), rpId: e('exemplo.com'),
    userHandle: e(b64('u-1')), userName: e('eu@exemplo.com'), counter: e('0'), discoverable: e('true'), creationDate: '2026-01-01T00:00:00Z' };
  const sync = { profile: { id: 'user-1', key: acc.protectedUserKey, privateKey: acc.encryptedPrivateKey, organizations: [] },
    ciphers: [{ id: 'login-1', type: 1, name: e('Exemplo'), login: { username: e('eu@exemplo.com'), uris: [{ uri: e('https://exemplo.com'), match: null }], fido2Credentials: [fido] } }] };
  const vault = UnlockedVault.open(sync, masterKey);
  const saved: { where: string; passkey: NewPasskey }[] = [];
  let changes = 0;
  const deps: PasskeyDeps = {
    status: () => status, vault: () => (status === 'unlocked' ? vault : null),
    loginsFor: (url) => vault.logins.filter((l) => l.uris.some((u) => new URL(u.uri).host === new URL(url).host)),
    saveNew: async (name, _uri, pk) => { saved.push({ where: `novo:${name}`, passkey: { ...pk, privateKey: Buffer.from(pk.privateKey) } }); return true; },
    saveTo: async (id, pk) => { saved.push({ where: id, passkey: { ...pk, privateKey: Buffer.from(pk.privateKey) } }); return true; },
    updateCounter: async () => true, onChange: () => { changes++; }, canFallback,
  };
  return { broker: new PasskeyBroker(deps), publicKey, saved, changes: () => changes, setStatus: (s: typeof status) => { status = s; } };
}

const verify = (pub: crypto.KeyObject, ok: Record<string, string>) => crypto.verify('sha256',
  Buffer.concat([Buffer.from(ok.authenticatorData, 'base64url'), crypto.createHash('sha256').update(Buffer.from(ok.clientDataJSON, 'base64url')).digest()]),
  { key: pub, dsaEncoding: 'der' }, Buffer.from(ok.signature, 'base64url'));

describe('pedidos de passkey da página', () => {
  it('pedido malformado ou grande demais é recusado', () => {
    expect(parseRequest('{')).toBeNull();
    expect(parseRequest(getReq({ challenge: 'curto' }))).toBeNull(); // desafio com menos de 16 bytes
    expect(parseRequest(getReq({ allow: ['!!'] }))).toBeNull();
    expect(parseRequest(createReq({ userId: b64(Buffer.alloc(65)) }))).toBeNull(); // id do usuário até 64 bytes
    expect(parseRequest(createReq({ userName: 5 }))).toBeNull();
    expect(parseRequest('x'.repeat(70_000))).toBeNull();
    expect(parseRequest(getReq())).toMatchObject({ kind: 'get', rpId: 'exemplo.com', conditional: false });
  });

  it('entrar: a janela lista a passkey do site; escolher devolve a assinatura certa', async () => {
    const { broker, publicKey } = await setup();
    const pending = broker.request('aba-1', 'https://exemplo.com', getReq());
    const info = broker.promptFor('aba-1')!;
    expect(info).toMatchObject({ kind: 'get', site: 'exemplo.com', vault: 'unlocked', message: null });
    expect(info.options.map((o) => o.label)).toEqual(['eu@exemplo.com']);
    expect(broker.promptFor('outra-aba')).toBeNull();
    await broker.answer(info.id, info.options[0].id);
    const r = await pending as { ok: Record<string, string> };
    expect(verify(publicKey, r.ok)).toBe(true);
    expect(Buffer.from(r.ok.id, 'base64url').toString('hex')).toBe(GUID.replace(/-/g, ''));
    expect(Buffer.from(r.ok.userHandle, 'base64url').toString()).toBe('u-1');
    expect(JSON.parse(Buffer.from(r.ok.clientDataJSON, 'base64url').toString())).toMatchObject({ type: 'webauthn.get', origin: 'https://exemplo.com' });
    expect(broker.promptFor('aba-1')).toBeNull();
  });

  it('site de outro domínio não usa a passkey; sem passkey: aviso, e cancelar dá NotAllowedError', async () => {
    const { broker } = await setup();
    expect(await broker.request('aba-1', 'https://outro.com', getReq())).toMatchObject({ error: 'SecurityError' });
    const pending = broker.request('aba-1', 'https://outro.com', getReq({ rpId: 'outro.com' }));
    const info = broker.promptFor('aba-1')!;
    expect(info.options).toEqual([]);
    expect(info.message).toContain('Nenhuma passkey de outro.com');
    await broker.answer(info.id, null);
    expect(await pending).toMatchObject({ error: 'NotAllowedError' });
  });

  it('lista do site (allowCredentials) que não inclui a passkey: ela não aparece', async () => {
    const { broker } = await setup();
    void broker.request('aba-1', 'https://exemplo.com', getReq({ allow: [b64(crypto.randomBytes(16))] }));
    expect(broker.promptFor('aba-1')!.options).toEqual([]);
    broker.cancelTab('aba-1');
  });

  // Regressão: com mais de uma opção (login novo + login do site) nenhuma vinha marcada e o
  // botão "Salvar passkey" ficava desativado, parecendo quebrado (cadastro de MFA na AWS).
  it('criar: a janela já abre com onde salvar marcado', async () => {
    const { broker } = await setup();
    void broker.request('aba-1', 'https://exemplo.com', createReq());
    // O único login do site já tem passkey: não troca sem o usuário pedir, sugere um novo.
    expect(broker.promptFor('aba-1')!.selected).toBe('new');
    broker.cancelTab('aba-1');
    void broker.request('aba-1', 'https://exemplo.com', getReq());
    expect(broker.promptFor('aba-1')!.selected).toBe(broker.promptFor('aba-1')!.options[0].id);
    broker.cancelTab('aba-1');
  });

  it('criar: salva no Bitwarden (login novo ou existente) e devolve o atestado', async () => {
    const { broker, saved } = await setup();
    const pending = broker.request('aba-1', 'https://exemplo.com', createReq());
    const info = broker.promptFor('aba-1')!;
    expect(info).toMatchObject({ kind: 'create', userName: 'eu@exemplo.com', message: null });
    expect(info.options.map((o) => [o.id, o.replaces])).toEqual([['new', false], ['login-1', true]]); // o existente já tem uma
    await broker.answer(info.id, 'new');
    const r = await pending as { ok: Record<string, unknown> };
    expect(saved).toHaveLength(1);
    expect(saved[0].where).toBe('novo:exemplo.com');
    expect(saved[0].passkey).toMatchObject({ rpId: 'exemplo.com', userName: 'eu@exemplo.com', discoverable: true });
    expect(saved[0].passkey.userHandle!.toString()).toBe('u-1');
    // A chave guardada é a mesma cuja pública foi para o site.
    const pub = crypto.createPublicKey({ key: Buffer.from(r.ok.publicKey as string, 'base64url'), format: 'der', type: 'spki' });
    const priv = crypto.createPrivateKey({ key: saved[0].passkey.privateKey, format: 'der', type: 'pkcs8' });
    expect(crypto.createPublicKey(priv).export({ format: 'jwk' })).toEqual(pub.export({ format: 'jwk' }));
    expect(Buffer.from(r.ok.id as string, 'base64url').toString('hex')).toBe(saved[0].passkey.credentialId.replace(/-/g, ''));
  });

  it('criar com a passkey já registrada (excludeCredentials): aviso e InvalidStateError', async () => {
    const { broker, saved } = await setup();
    const pending = broker.request('aba-1', 'https://exemplo.com', createReq({ exclude: [b64(Buffer.from(GUID.replace(/-/g, ''), 'hex'))] }));
    const info = broker.promptFor('aba-1')!;
    expect(info.options).toEqual([]);
    expect(info.message).toContain('já tem uma passkey');
    await broker.answer(info.id, null); // a janela só tem "Cancelar"
    expect(saved).toEqual([]);
    expect(await pending).toMatchObject({ error: 'InvalidStateError' });
  });

  it('cofre bloqueado: a janela pede desbloqueio; desbloqueado, as opções aparecem', async () => {
    const { broker, setStatus } = await setup('locked');
    void broker.request('aba-1', 'https://exemplo.com', getReq());
    expect(broker.promptFor('aba-1')).toMatchObject({ vault: 'locked', options: [] });
    setStatus('unlocked');
    expect(broker.promptFor('aba-1')!.options).toHaveLength(1);
    broker.cancelTab('aba-1');
  });

  it('condicional: sem janela; o menu da chave mostra a passkey e escolher entra', async () => {
    const { broker, publicKey } = await setup();
    const pending = broker.request('aba-1', 'https://exemplo.com', getReq({ conditional: true }));
    expect(broker.promptFor('aba-1')).toBeNull();
    const opts = broker.conditionalOptions('aba-1');
    expect(opts.map((o) => o.label)).toEqual(['eu@exemplo.com']);
    broker.useConditional('aba-1', opts[0].id);
    expect(verify(publicKey, (await pending as { ok: Record<string, string> }).ok)).toBe(true);
    expect(broker.conditionalOptions('aba-1')).toEqual([]);
  });

  it('site aborta (AbortSignal) ou a aba navega: o pedido some', async () => {
    const { broker } = await setup();
    const a = broker.request('aba-1', 'https://exemplo.com', getReq({ id: 7 }));
    broker.cancel('aba-1', 7);
    expect(await a).toMatchObject({ error: 'AbortError' });
    const b = broker.request('aba-1', 'https://exemplo.com', getReq({ conditional: true }));
    broker.cancelTab('aba-1');
    expect(await b).toMatchObject({ error: 'NotAllowedError' });
  });

  it('Windows: "usar outro método" entrega ao sistema; no Linux não existe', async () => {
    const win = await setup('unlocked', true);
    const p = win.broker.request('aba-1', 'https://exemplo.com', getReq());
    expect(win.broker.promptFor('aba-1')!.canFallback).toBe(true);
    await win.broker.answer(win.broker.promptFor('aba-1')!.id, null, true);
    expect(await p).toEqual({ fallback: true });
    const linux = await setup();
    const q = linux.broker.request('aba-1', 'https://exemplo.com', getReq());
    await linux.broker.answer(linux.broker.promptFor('aba-1')!.id, null, true);
    expect(await q).toMatchObject({ error: 'NotAllowedError' });
    // Algoritmo que o Bitwarden não cria: Windows entrega ao sistema; Linux recusa.
    expect(await win.broker.request('aba-1', 'https://exemplo.com', createReq({ algs: [-257] }))).toEqual({ fallback: true });
    expect(await linux.broker.request('aba-1', 'https://exemplo.com', createReq({ algs: [-257] }))).toMatchObject({ error: 'NotSupportedError' });
  });

  it('um pedido por aba: o segundo é recusado enquanto o primeiro está aberto', async () => {
    const { broker } = await setup();
    void broker.request('aba-1', 'https://exemplo.com', getReq());
    expect(await broker.request('aba-1', 'https://exemplo.com', getReq({ id: 9 }))).toMatchObject({ error: 'NotAllowedError' });
    broker.cancelTab('aba-1');
  });
});
