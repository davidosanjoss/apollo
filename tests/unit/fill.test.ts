// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fillLogin } from '../../src/preload/fill';

const html = (s: string) => { document.body.innerHTML = s; };
const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

beforeEach(() => { document.body.innerHTML = ''; });

describe('fillLogin', () => {
  it('formulário clássico: usuário antes da senha', () => {
    html(`<form><input name="q" type="search"><input id="u" name="email" type="email"><input id="p" type="password"></form>`);
    expect(fillLogin(document, 'eu@x.com', 's3nha')).toEqual({ username: true, password: true });
    expect(val('#u')).toBe('eu@x.com');
    expect(val('#p')).toBe('s3nha');
    expect(val('[name=q]')).toBe('');
  });

  it('dispara input/change (React, Angular etc.)', () => {
    html(`<input id="u" name="user"><input id="p" type="password">`);
    const seen: string[] = [];
    document.getElementById('p')!.addEventListener('input', () => seen.push('input'));
    document.getElementById('p')!.addEventListener('change', () => seen.push('change'));
    fillLogin(document, 'eu', 'x');
    expect(seen).toEqual(['input', 'change']);
  });

  it('login em duas etapas (ex.: Microsoft): só o e-mail na primeira tela', () => {
    html(`<input type="email" name="loginfmt" id="i0116"><input type="submit">`);
    expect(fillLogin(document, 'eu@empresa.com', 'segredo')).toEqual({ username: true, password: false });
    expect(val('#i0116')).toBe('eu@empresa.com');
  });

  it('segunda etapa: só a senha', () => {
    html(`<input type="password" name="passwd">`);
    expect(fillLogin(document, 'eu@empresa.com', 'segredo')).toEqual({ username: false, password: true });
  });

  it('ignora campos escondidos, desabilitados e somente leitura (armadilhas)', () => {
    html(`<form>
      <input id="armadilha" name="username" style="display:none">
      <div hidden><input id="armadilha2" type="password"></div>
      <input id="ro" name="login" readonly>
      <input id="u" name="usuario"><input id="p" type="password">
    </form>`);
    fillLogin(document, 'eu', 'senha');
    expect(val('#u')).toBe('eu');
    expect(val('#p')).toBe('senha');
    expect(val('#armadilha') + val('#armadilha2') + val('#ro')).toBe('');
  });

  it('sem campos de login: nada acontece', () => {
    html(`<input type="search" name="q">`);
    expect(fillLogin(document, 'eu', 'senha')).toEqual({ username: false, password: false });
    expect(val('[name=q]')).toBe('');
  });
});
