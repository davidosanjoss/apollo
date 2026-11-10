import { describe, expect, it } from 'vitest';
import { diff, dropOrphans, emptyData, hasChanges, merge3, parseData, same, type SyncData } from '../../src/main/sync/merge';
import { open, seal, WrongPassphrase } from '../../src/main/sync/crypto';

const ws = (name: string) => ({ name, color: '#000000', home: '', hibernateAfterMin: 30, hiddenHibernateMin: 10, position: 0 });
const bm = (workspaceId: string, title: string, parentId: string | null = null, folder = false) =>
  ({ workspaceId, parentId, folder, title, url: folder ? '' : `https://${title}.com`, position: 0 });
const data = (over: Partial<SyncData> = {}): SyncData => ({ ...emptyData(), ...over });

describe('mesclagem em três vias', () => {
  const base = data({ workspaces: { w: ws('Principal') }, bookmarks: { a: bm('w', 'a'), b: bm('w', 'b') } });

  it('mudanças de lados diferentes se juntam (adicionar, editar, apagar)', () => {
    const local = data({ workspaces: { w: ws('Principal') }, bookmarks: { a: { ...bm('w', 'a'), title: 'A local' }, b: bm('w', 'b'), c: bm('w', 'c') } });
    const remote = data({ workspaces: { w: ws('Principal') }, bookmarks: { a: bm('w', 'a'), d: bm('w', 'd') } }); // apagou b, criou d
    const m = merge3(base, local, remote);
    expect(Object.keys(m.bookmarks).sort()).toEqual(['a', 'c', 'd']);
    expect(m.bookmarks.a.title).toBe('A local');
  });

  it('os dois mudaram o mesmo item: vale este computador; apagado x editado: fica a edição', () => {
    const local = data({ workspaces: { w: ws('Principal') }, bookmarks: { a: { ...bm('w', 'a'), title: 'daqui' } } }); // apagou b
    const remote = data({ workspaces: { w: ws('Principal') }, bookmarks: { a: { ...bm('w', 'a'), title: 'de lá' }, b: { ...bm('w', 'b'), title: 'B editado' } } });
    const m = merge3(base, local, remote);
    expect(m.bookmarks.a.title).toBe('daqui');
    expect(m.bookmarks.b.title).toBe('B editado');
  });

  it('workspace apagado leva os favoritos dele; pasta que sumiu leva os de dentro', () => {
    const d = dropOrphans(data({ workspaces: { w: ws('W') }, bookmarks: {
      x: bm('sumiu', 'x'), f: bm('w', 'f', null, true), y: bm('w', 'y', 'f'), z: bm('w', 'z', 'nao-existe'), zz: bm('w', 'zz', 'z', true) } }));
    expect(Object.keys(d.bookmarks).sort()).toEqual(['f', 'y']);
  });

  it('diff: o que aplicar para chegar ao resultado', () => {
    const to = data({ workspaces: { w: { ...ws('Principal'), color: '#ffffff' } }, bookmarks: { a: bm('w', 'a'), n: bm('w', 'n') }, prefs: { spellcheck: 'pt' } });
    const ch = diff(base, to);
    expect(ch).toEqual({ upsert: { workspaces: ['w'], bookmarks: ['n'], prefs: ['spellcheck'] }, remove: { bookmarks: ['b'] } });
    expect(hasChanges(diff(base, base))).toBe(false);
    expect(same({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
  });

  it('formato inválido vindo da nuvem é recusado', () => {
    expect(() => parseData({ v: 2 })).toThrow();
    expect(() => parseData({ ...emptyData(), bookmarks: [] })).toThrow();
    expect(parseData(emptyData())).toEqual(emptyData());
  });
});

describe('criptografia do arquivo', () => {
  it('cifra e abre com a mesma senha; o arquivo não mostra o conteúdo', async () => {
    const value = data({ bookmarks: { a: bm('w', 'segredo-do-moodle') } });
    const sealed = await seal(value, 'senha forte 123');
    expect(sealed.toString()).not.toContain('segredo');
    expect(await open(sealed, 'senha forte 123')).toEqual(value);
  });

  it('senha errada (ou arquivo adulterado) não abre', async () => {
    const sealed = await seal({ x: 1 }, 'certa');
    await expect(open(sealed, 'errada')).rejects.toBeInstanceOf(WrongPassphrase);
    const env = JSON.parse(sealed.toString());
    env.data = Buffer.from('lixo').toString('base64');
    await expect(open(Buffer.from(JSON.stringify(env)), 'certa')).rejects.toBeInstanceOf(WrongPassphrase);
  });
});

describe('posições', () => {
  // Regressão: a normalização alterava os dados de entrada; o diff não via a mudança.
  it('itens na mesma posição viram 0..n (empate pelo id) sem mexer nas entradas', () => {
    const local = data({ workspaces: { w: ws('W') }, bookmarks: { b: bm('w', 'b'), a: bm('w', 'a') } });
    const before = structuredClone(local);
    const m = merge3(emptyData(), local, emptyData());
    expect([m.bookmarks.a.position, m.bookmarks.b.position]).toEqual([0, 1]);
    expect(local).toEqual(before);
    expect(diff(local, m).upsert.bookmarks).toEqual(['b']);
  });
});

describe('primeira conexão de um computador', () => {
  it('a nuvem vence quando os dois têm o mesmo item diferente; o resto se junta', () => {
    const local = data({ workspaces: { w: { ...ws('Principal'), color: '#111111' } }, prefs: { spellcheck: 'pt-en', 'bookmark-bar': '1' } });
    const remote = data({ workspaces: { w: { ...ws('Principal'), color: '#999999' } }, prefs: { spellcheck: 'pt' } });
    const m = merge3(emptyData(), local, remote, 'remote');
    expect(m.workspaces.w.color).toBe('#999999');
    expect(m.prefs).toEqual({ spellcheck: 'pt', 'bookmark-bar': '1' });
  });
});
