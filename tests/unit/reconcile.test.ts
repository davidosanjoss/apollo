// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcile } from '../../src/renderer/reconcile';

interface Item { id: string; label: string }

let parent: HTMLElement;
let cache: Map<string, HTMLElement>;
let created: string[];

const render = (items: Item[]) => reconcile(parent, cache, items, (i) => i.id,
  (i) => { created.push(i.id); return document.createElement('div'); },
  (node, i, index) => { node.textContent = `${index}:${i.label}`; });
const ids = () => [...parent.children].map((c) => c.textContent);

beforeEach(() => {
  parent = document.createElement('div');
  document.body.replaceChildren(parent);
  cache = new Map();
  created = [];
});

describe('reconcile', () => {
  it('cria os elementos na ordem', () => {
    render([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    expect(ids()).toEqual(['0:A', '1:B']);
  });

  // Regressão: a lista era recriada a cada estado; o botão × era trocado entre o
  // mousedown e o mouseup e o clique para fechar a aba se perdia.
  it('reaproveita o mesmo elemento entre renderizações', () => {
    render([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    const before = cache.get('b');
    render([{ id: 'a', label: 'A' }, { id: 'b', label: 'B2' }]);
    expect(cache.get('b')).toBe(before);
    expect(parent.children[1]).toBe(before);
    expect(created).toEqual(['a', 'b']);
    expect(ids()).toEqual(['0:A', '1:B2']);
  });

  it('clique iniciado antes de uma atualização chega ao mesmo botão', () => {
    render([{ id: 'a', label: 'A' }]);
    const btn = cache.get('a')!;
    let clicks = 0;
    btn.addEventListener('click', () => clicks++);
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    render([{ id: 'a', label: 'A (carregando)' }]); // estado novo no meio do clique
    expect(btn.isConnected).toBe(true);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toBe(1);
  });

  it('remove os que saíram e insere novos na posição certa', () => {
    render([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
    render([{ id: 'c', label: 'C' }, { id: 'n', label: 'N' }, { id: 'a', label: 'A' }]);
    expect(ids()).toEqual(['0:C', '1:N', '2:A']);
    expect(cache.has('b')).toBe(false);
    expect(parent.children).toHaveLength(3);
  });

  it('lista vazia limpa tudo', () => {
    render([{ id: 'a', label: 'A' }]);
    render([]);
    expect(parent.children).toHaveLength(0);
    expect(cache.size).toBe(0);
  });
});
