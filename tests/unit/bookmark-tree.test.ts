import { describe, expect, it } from 'vitest';
import { dropPlace, dropTarget, folderOptions, folderPath, isInside } from '../../src/renderer/bookmark-tree';
import type { BookmarkInfo } from '../../src/shared/types';

const bm = (id: string, parentId: string | null = null, folder = false): BookmarkInfo =>
  ({ id, title: id.toUpperCase(), url: folder ? '' : `https://${id}.com`, favicon: null, parentId, folder });
// barra: a, F(pasta: b, S(pasta: c)), d
const list = [bm('a'), bm('f', null, true), bm('b', 'f'), bm('s', 'f', true), bm('c', 's'), bm('d')];

describe('árvore de favoritos', () => {
  it('caminho e "está dentro"', () => {
    expect(folderPath(list, 'c')).toEqual(['F', 'S']);
    expect(folderPath(list, 'a')).toEqual([]);
    expect(isInside(list, 's', 'f')).toBe(true);
    expect(isInside(list, 'f', 's')).toBe(false);
  });

  it('opções de pasta com recuo; sem a própria pasta e as de dentro', () => {
    expect(folderOptions(list).map((o) => o.id)).toEqual([null, 'f', 's']);
    expect(folderOptions(list).map((o) => o.label.trim())).toEqual(['Barra de favoritos', '📁 F', '📁 S']);
    expect(folderOptions(list, 'f').map((o) => o.id)).toEqual([null]);
  });

  it('soltar antes/depois na mesma pasta: posição final sem o arrastado', () => {
    expect(dropTarget(list, 'a', 'd', 'after')).toEqual({ parentId: null, index: 2 }); // f, d, a
    expect(dropTarget(list, 'd', 'a', 'before')).toEqual({ parentId: null, index: 0 });
  });

  it('soltar dentro de pasta vai para o fim; de outra pasta para a barra', () => {
    expect(dropTarget(list, 'a', 'f', 'into')).toEqual({ parentId: 'f', index: 2 });
    expect(dropTarget(list, 'c', 'a', 'after')).toEqual({ parentId: null, index: 1 });
  });

  it('inválido: pasta nela mesma / numa subpasta; "dentro" de favorito', () => {
    expect(dropTarget(list, 'f', 's', 'into')).toBeNull();
    expect(dropTarget(list, 'f', 'c', 'before')).toBeNull();
    expect(dropTarget(list, 'f', 'f', 'into')).toBeNull();
    expect(dropTarget(list, 'a', 'd', 'into')).toBeNull();
  });

  it('meio da pasta = dentro; favorito só antes/depois', () => {
    expect(dropPlace(true, 0.5)).toBe('into');
    expect(dropPlace(true, 0.1)).toBe('before');
    expect(dropPlace(true, 0.9)).toBe('after');
    expect(dropPlace(false, 0.5)).toBe('after');
  });
});
