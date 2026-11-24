// Passkeys pelo Bitwarden: o script abaixo roda no mundo da página (injetado pelo preload,
// antes dos scripts do site) e troca navigator.credentials.create/get com publicKey por um
// pedido ao Apollo. A conversa com o preload é por eventos no document, só com texto (JSON):
// objetos não atravessam do mundo isolado para o da página.
//
// A página pode disparar esses eventos ela mesma: dá no mesmo que chamar a API. Quem decide
// é o processo principal (origem tirada do próprio frame) e o usuário (janela do Apollo).
export const WEBAUTHN_REQUEST = 'apollo-webauthn-request';
export const WEBAUTHN_RESPONSE = 'apollo-webauthn-response';
export const WEBAUTHN_CANCEL = 'apollo-webauthn-cancel';

export function webauthnShim(): string {
  return `(() => {
  const C = navigator.credentials;
  const PKC = window.PublicKeyCredential;
  if (!C || typeof PKC !== 'function') return;
  const realCreate = C.create.bind(C);
  const realGet = C.get.bind(C);
  const view = (b) => b instanceof ArrayBuffer ? new Uint8Array(b) : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null;
  const b64 = (b) => { const u = view(b); if (!u) throw new TypeError('BufferSource esperado'); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); };
  const buf = (s) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u.buffer; };
  let seq = 0;
  const waiting = new Map();
  document.addEventListener('${WEBAUTHN_RESPONSE}', (e) => {
    let r; try { r = JSON.parse(e.detail); } catch { return; }
    const w = waiting.get(r && r.id);
    if (w) { waiting.delete(r.id); w(r); }
  });
  const ask = (req, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason ?? new DOMException('A operação foi abortada.', 'AbortError'));
    const id = ++seq;
    waiting.set(id, resolve);
    if (signal) signal.addEventListener('abort', () => {
      if (!waiting.delete(id)) return;
      document.dispatchEvent(new CustomEvent('${WEBAUTHN_CANCEL}', { detail: JSON.stringify({ id }) }));
      reject(signal.reason ?? new DOMException('A operação foi abortada.', 'AbortError'));
    }, { once: true });
    document.dispatchEvent(new CustomEvent('${WEBAUTHN_REQUEST}', { detail: JSON.stringify({ ...req, id }) }));
  });
  const own = (o, props) => { for (const k in props) Object.defineProperty(o, k, { value: props[k], enumerable: true, configurable: true }); return o; };
  const credential = (r, create) => {
    const rawId = buf(r.id);
    const json = { id: r.id, rawId: r.id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: create ? { credProps: { rk: r.rk } } : {} };
    let response;
    if (create) {
      const ad = buf(r.authenticatorData), pk = buf(r.publicKey);
      response = own(Object.create(AuthenticatorAttestationResponse.prototype), {
        clientDataJSON: buf(r.clientDataJSON), attestationObject: buf(r.attestationObject),
        getTransports: () => r.transports.slice(), getAuthenticatorData: () => ad.slice(0),
        getPublicKey: () => pk.slice(0), getPublicKeyAlgorithm: () => r.publicKeyAlgorithm,
      });
      json.response = { clientDataJSON: r.clientDataJSON, attestationObject: r.attestationObject, authenticatorData: r.authenticatorData,
        publicKey: r.publicKey, publicKeyAlgorithm: r.publicKeyAlgorithm, transports: r.transports.slice() };
    } else {
      response = own(Object.create(AuthenticatorAssertionResponse.prototype), {
        clientDataJSON: buf(r.clientDataJSON), authenticatorData: buf(r.authenticatorData), signature: buf(r.signature),
        userHandle: r.userHandle ? buf(r.userHandle) : null,
      });
      json.response = { clientDataJSON: r.clientDataJSON, authenticatorData: r.authenticatorData, signature: r.signature, userHandle: r.userHandle };
    }
    return own(Object.create(PKC.prototype), {
      id: r.id, rawId, type: 'public-key', authenticatorAttachment: 'platform', response,
      getClientExtensionResults: () => JSON.parse(JSON.stringify(json.clientExtensionResults)),
      toJSON: () => JSON.parse(JSON.stringify(json)),
    });
  };
  const settle = (r, create, fallback) => {
    if (r.fallback) return fallback();
    if (r.error) throw new DOMException(r.message, r.error);
    return credential(r.ok, create);
  };
  const ids = (list) => (list || []).map((c) => b64(c.id));
  const create = function create(options) {
    const pk = options && options.publicKey;
    if (!pk) return realCreate(options);
    let req;
    try {
      const sel = pk.authenticatorSelection || {};
      req = { kind: 'create', rpId: pk.rp && pk.rp.id, rpName: pk.rp && pk.rp.name, userId: b64(pk.user.id), userName: pk.user.name,
        userDisplayName: pk.user.displayName, challenge: b64(pk.challenge), algs: (pk.pubKeyCredParams || []).map((p) => p.alg),
        exclude: ids(pk.excludeCredentials), residentKey: sel.residentKey ? sel.residentKey !== 'discouraged' : sel.requireResidentKey !== false };
    } catch (e) { return Promise.reject(e instanceof DOMException ? e : new TypeError(String(e && e.message || e))); }
    return ask(req, options.signal).then((r) => settle(r, true, () => realCreate(options)));
  };
  const get = function get(options) {
    const pk = options && options.publicKey;
    if (!pk) return realGet(options);
    let req;
    try {
      req = { kind: 'get', rpId: pk.rpId, challenge: b64(pk.challenge), allow: ids(pk.allowCredentials), conditional: options.mediation === 'conditional' };
    } catch (e) { return Promise.reject(e instanceof DOMException ? e : new TypeError(String(e && e.message || e))); }
    return ask(req, options.signal).then((r) => settle(r, false, () => realGet(options)));
  };
  // Mesma cara das funções nativas (alguns sites conferem com toString).
  const native = (f, name) => { Object.defineProperty(f, 'name', { value: name }); f.toString = () => 'function ' + name + '() { [native code] }'; return f; };
  Object.defineProperty(C, 'create', { value: native(create, 'create'), configurable: true, writable: true });
  Object.defineProperty(C, 'get', { value: native(get, 'get'), configurable: true, writable: true });
  // O Bitwarden é um autenticador "da plataforma" que verifica o usuário (senha mestra).
  const yes = () => Promise.resolve(true);
  PKC.isUserVerifyingPlatformAuthenticatorAvailable = native(yes, 'isUserVerifyingPlatformAuthenticatorAvailable');
  PKC.isConditionalMediationAvailable = native(yes, 'isConditionalMediationAvailable');
  if (typeof PKC.getClientCapabilities === 'function') {
    const realCaps = PKC.getClientCapabilities.bind(PKC);
    PKC.getClientCapabilities = native(() => realCaps().then((c) => ({ ...c, conditionalGet: true, conditionalCreate: false,
      passkeyPlatformAuthenticator: true, userVerifyingPlatformAuthenticator: true, hybridTransport: false })), 'getClientCapabilities');
  }
})();`;
}
