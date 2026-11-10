// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureLogin, captureUsernameStep, watchLogins, type Captured } from '../../src/preload/capture';
import { fillNewPassword } from '../../src/preload/fill';

const html = (s: string) => { document.body.innerHTML = s; };
const set = (sel: string, v: string) => { (document.querySelector(sel) as HTMLInputElement).value = v; };

beforeEach(() => { document.body.innerHTML = ''; });

describe('captureLogin', () => {
  it('usuário e senha digitados', () => {
    html(`<form><input id="u" name="email"><input id="p" type="password"></form>`);
    set('#u', ' eu@x.com '); set('#p', 's3nha');
    expect(captureLogin(document)).toEqual({ username: 'eu@x.com', password: 's3nha' });
  });

  it('sem senha digitada: nada', () => {
    html(`<input id="u" name="email"><input id="p" type="password">`);
    set('#u', 'eu');
    expect(captureLogin(document)).toBeNull();
  });

  it('só senha (segunda etapa): usuário desconhecido', () => {
    html(`<input id="p" type="password">`);
    set('#p', 'x');
    expect(captureLogin(document)).toEqual({ username: null, password: 'x' });
  });

  it('primeira etapa: só o e-mail', () => {
    html(`<input id="u" type="email" name="loginfmt">`);
    set('#u', 'eu@empresa.com');
    expect(captureUsernameStep(document)).toBe('eu@empresa.com');
    html(`<input id="u" type="email"><input type="password">`);
    expect(captureUsernameStep(document)).toBeNull();
  });
});

describe('watchLogins', () => {
  function setup() {
    const logins: Captured[] = [];
    const users: string[] = [];
    watchLogins(document, (c) => logins.push(c), (u) => users.push(u));
    return { logins, users };
  }

  it('submit do formulário', () => {
    html(`<form id="f"><input id="u" name="user"><input id="p" type="password"><button>Entrar</button></form>`);
    const { logins } = setup();
    set('#u', 'eu'); set('#p', 'pw');
    document.getElementById('f')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(logins).toEqual([{ username: 'eu', password: 'pw' }]);
  });

  it('SPA sem formulário: clique no botão; clique + submit do mesmo envio contam uma vez', () => {
    html(`<div><input id="u" name="email"><input id="p" type="password"><div role="button" id="b">Entrar</div></div>`);
    const { logins } = setup();
    set('#u', 'eu'); set('#p', 'pw');
    document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new Event('submit'));
    expect(logins).toHaveLength(1);
  });

  it('Enter no campo de senha', () => {
    html(`<input id="u" name="email"><input id="p" type="password">`);
    const { logins } = setup();
    set('#u', 'eu'); set('#p', 'pw');
    document.getElementById('p')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(logins).toEqual([{ username: 'eu', password: 'pw' }]);
  });

  it('primeira etapa reporta o e-mail; cliques em outros lugares não reportam nada', () => {
    html(`<input id="u" type="email"><button id="b">Avançar</button><a id="link">ajuda</a>`);
    const { logins, users } = setup();
    set('#u', 'eu@empresa.com');
    document.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(users).toEqual([]);
    document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(users).toEqual(['eu@empresa.com']);
    expect(logins).toEqual([]);
  });
});

describe('fillNewPassword (gerador)', () => {
  it('preenche senha e confirmação vazias; não mexe na senha atual já digitada', () => {
    html(`<input id="atual" type="password"><input id="nova" type="password"><input id="conf" type="password">`);
    set('#atual', 'velha');
    expect(fillNewPassword(document, 'G3rad@')).toBe(2);
    expect([...document.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value)).toEqual(['velha', 'G3rad@', 'G3rad@']);
  });
});
