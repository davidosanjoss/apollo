'use strict';
const params = new URLSearchParams(location.search);
const url = params.get('url') || '';
let host = url;
try { host = new URL(url).host || url; } catch { /* mantém o texto */ }
document.getElementById('host').textContent = host;
document.getElementById('detail').textContent = `${params.get('desc') || 'Erro desconhecido'} (${params.get('code') || '?'})`;
document.getElementById('retry').onclick = () => {
  // Só tenta de novo endereços web; nada de javascript:, file: etc.
  if (/^https?:\/\//i.test(url)) location.href = url;
};
