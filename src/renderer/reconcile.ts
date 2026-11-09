// Atualiza a lista reaproveitando os elementos existentes (chave = id). Recriar tudo
// a cada estado trocava o botão entre o "apertar" e o "soltar" do mouse, e o clique
// se perdia (ex.: fechar aba com a barra de endereço focada exigia dois cliques).
export function reconcile<T>(
  parent: HTMLElement, cache: Map<string, HTMLElement>, items: T[], key: (item: T) => string,
  create: (item: T) => HTMLElement, update: (node: HTMLElement, item: T, index: number) => void,
): void {
  const keep = new Set(items.map(key));
  for (const [id, node] of cache) {
    if (!keep.has(id)) { node.remove(); cache.delete(id); }
  }
  items.forEach((item, i) => {
    const id = key(item);
    let node = cache.get(id);
    if (!node) { node = create(item); cache.set(id, node); }
    update(node, item, i);
    // Só move o nó se ele estiver fora de posição.
    if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
  });
}
