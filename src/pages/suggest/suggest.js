// Lista de sugestões da barra de endereço (desenho e clique; quem decide é o main).
const list = document.getElementById('list');
const ICON = { search: '⌕', history: '🕘', bookmark: '★', tab: '⧉' };
const BADGE = { tab: 'Ir para a aba' };

function bare(url) {
  let u = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  try { u = decodeURI(u); } catch { /* como está */ }
  return u;
}

function select(index) {
  list.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('selected', i === index);
    li.setAttribute('aria-selected', String(i === index));
  });
}

window.suggest.onItems(({ items, selected }) => {
  list.replaceChildren(...items.map((it, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = ICON[it.kind] ?? '';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = it.title || bare(it.url);
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = it.kind === 'search' ? '' : it.title ? bare(it.url) : '';
    li.classList.add(it.kind);
    // Como no Opera: uma linha separa as pesquisas sugeridas do que vem do computador.
    const prev = items[i - 1];
    if (prev && (prev.kind === 'search') !== (it.kind === 'search')) li.classList.add('divider');
    li.append(icon, title, url);
    if (BADGE[it.kind]) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = BADGE[it.kind];
      li.append(b);
    }
    // mousedown (e não click): escolhe antes de a barra perder o foco e fechar a lista.
    li.addEventListener('mousedown', (e) => { e.preventDefault(); window.suggest.pick(i); });
    return li;
  }));
  select(selected);
});
window.suggest.onSelect(select);
