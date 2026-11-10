import { describe, expect, it } from 'vitest';
import { decideSave, itemName } from '../../src/main/vault/save';
import type { VaultLogin } from '../../src/main/vault/vault';

const login = (id: string, username: string | null, uri = 'https://site.com'): VaultLogin =>
  ({ id, name: id, username, uris: [{ uri, match: null }], hasTotp: false, organizationId: null });
const pw: Record<string, string> = { a: 'senha-a', b: 'senha-b', outro: 'x' };
const passwordOf = (id: string) => pw[id] ?? null;
const URL_ = 'https://www.site.com/login';

describe('decideSave', () => {
  it('login novo no site: salvar', () => {
    expect(decideSave([login('outro', 'eu', 'https://outro.com')], passwordOf, URL_, 'eu', 'p')).toEqual({ mode: 'save' });
  });

  it('mesmo usuário e mesma senha: nada', () => {
    expect(decideSave([login('a', 'Eu@X.com')], passwordOf, URL_, 'eu@x.com', 'senha-a')).toBeNull();
  });

  it('mesmo usuário, senha nova: atualizar aquele item', () => {
    expect(decideSave([login('a', 'eu'), login('b', 'outra')], passwordOf, URL_, 'eu', 'nova')).toEqual({ mode: 'update', itemId: 'a' });
  });

  it('outro usuário no mesmo site: salvar novo', () => {
    expect(decideSave([login('a', 'eu')], passwordOf, URL_, 'colega', 'x')).toEqual({ mode: 'save' });
  });

  it('sem usuário e um único login no site: é a senha dele', () => {
    expect(decideSave([login('a', 'eu')], passwordOf, URL_, null, 'nova')).toEqual({ mode: 'update', itemId: 'a' });
    expect(decideSave([login('a', 'eu')], passwordOf, URL_, null, 'senha-a')).toBeNull();
    expect(decideSave([login('a', 'eu'), login('b', 'outra')], passwordOf, URL_, null, 'nova')).toEqual({ mode: 'save' });
  });
});

describe('itemName', () => {
  it('host sem www', () => {
    expect(itemName('https://www.site.com/login?x=1')).toBe('site.com');
    expect(itemName('https://portal.ufmg.br/')).toBe('portal.ufmg.br');
  });
});
