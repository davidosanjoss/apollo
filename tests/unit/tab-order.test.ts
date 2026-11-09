import { describe, expect, it } from 'vitest';
import { joinGroupInPlace, moveTab, normalize, setGroup, setPinned, type OrderTab } from '../../src/main/tab-order';

// Notação compacta: "a" normal, "*a" fixada, "a:g" no grupo g.
const tabs = (spec: string): OrderTab[] => spec.split(' ').map((s) => {
  const pinned = s.startsWith('*');
  const [id, groupId] = s.replace('*', '').split(':');
  return { id, pinned, groupId: groupId ?? null };
});
const show = (list: OrderTab[]) => list.map((t) => `${t.pinned ? '*' : ''}${t.id}${t.groupId ? `:${t.groupId}` : ''}`).join(' ');

describe('normalize', () => {
  it('fixadas primeiro, sem grupo', () => {
    expect(show(normalize(tabs('a *b c *d:g')))).toBe('*b *d a c');
  });

  it('junta o grupo onde está o primeiro membro', () => {
    expect(show(normalize(tabs('a x:g b y:g c')))).toBe('a x:g y:g b c');
  });

  it('não altera o que já está certo', () => {
    const t = tabs('*p a x:g y:g b z:h');
    expect(normalize(t)).toEqual(t);
  });
});

describe('moveTab (arrastar)', () => {
  it('move dentro das normais', () => {
    expect(show(moveTab(tabs('a b c d'), 'a', 2))).toBe('b c a d');
    expect(show(moveTab(tabs('a b c d'), 'd', 0))).toBe('d a b c');
  });

  it('fixada só se move entre fixadas; normal não entra na área das fixadas', () => {
    expect(show(moveTab(tabs('*p *q a b'), 'p', 3))).toBe('*q *p a b');
    expect(show(moveTab(tabs('*p *q a b'), 'b', 0))).toBe('*p *q b a');
  });

  it('soltar com groupId entra no grupo', () => {
    expect(show(moveTab(tabs('a x:g y:g b'), 'b', 2, 'g'))).toBe('a x:g b:g y:g');
  });

  it('soltar sem grupo no meio de um grupo: sai para depois do bloco', () => {
    expect(show(moveTab(tabs('a x:g y:g b'), 'a', 1, null))).toBe('x:g y:g a b');
  });

  it('tirar a última aba do grupo pelo arrasto', () => {
    expect(show(moveTab(tabs('x:g a b'), 'x', 2, null))).toBe('a b x');
  });

  it('id inexistente: nada muda; índice fora do intervalo é limitado', () => {
    const t = tabs('a b');
    expect(moveTab(t, 'zz', 0)).toBe(t);
    expect(show(moveTab(t, 'a', 99))).toBe('b a');
  });
});

describe('setPinned', () => {
  it('fixar vai para o fim das fixadas e sai do grupo', () => {
    expect(show(setPinned(tabs('*p a b x:g'), 'x', true))).toBe('*p *x a b');
  });

  it('desafixar vai para o começo das normais', () => {
    expect(show(setPinned(tabs('*p *q a'), 'p', false))).toBe('*q p a');
  });

  it('sem mudança devolve a mesma lista', () => {
    const t = tabs('*p a');
    expect(setPinned(t, 'p', true)).toBe(t);
  });
});

describe('setGroup', () => {
  it('entra no fim do bloco do grupo', () => {
    expect(show(setGroup(tabs('x:g y:g a b'), 'b', 'g'))).toBe('x:g y:g b:g a');
  });

  it('grupo novo (sem membros) fica onde a aba está', () => {
    expect(show(setGroup(tabs('a b c'), 'b', 'n'))).toBe('a b:n c');
  });

  it('sair do grupo vai para logo depois do bloco', () => {
    expect(show(setGroup(tabs('x:g y:g z:g a'), 'x', null))).toBe('y:g z:g x a');
  });

  it('fixada que entra num grupo deixa de ser fixada', () => {
    expect(show(setGroup(tabs('*p a x:g'), 'p', 'g'))).toBe('a x:g p:g');
  });
});

describe('joinGroupInPlace', () => {
  // Regressão: nova aba aberta a partir de uma aba do grupo ia para o fim do grupo
  // (setGroup), em vez de ficar logo ao lado da aba de origem.
  it('entra no grupo sem sair do lugar', () => {
    expect(show(joinGroupInPlace(tabs('c:g n a:g b'), 'n', 'g'))).toBe('c:g n:g a:g b');
  });

  it('fora do bloco: é puxada para junto do grupo', () => {
    expect(show(joinGroupInPlace(tabs('c:g b n'), 'n', 'g'))).toBe('c:g n:g b');
  });
});
