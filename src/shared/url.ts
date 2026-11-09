// Converte o que foi digitado na barra de endereço em URL (ou pesquisa).
export const SEARCH_URL = 'https://www.google.com/search?q=';

// Esquemas reconhecidos sem "//" (about:blank, mailto:x). Qualquer outro "algo:" sem
// "//" é tratado como texto: "localhost:3000", "example.com:8443" e "c++: dúvida"
// não são esquemas.
const BARE_SCHEMES = /^(about|data|mailto|view-source|javascript|tel):/i;
const WITH_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\//i;

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?(\/.*)?$/;
const LOCALHOST = /^localhost(:\d{1,5})?(\/.*)?$/i;
const DOMAIN = /^[^\s/:]+\.[a-z]{2,}(:\d{1,5})?(\/.*)?$/i;

export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (WITH_AUTHORITY.test(text) || BARE_SCHEMES.test(text)) return text;
  if (/\s/.test(text)) return SEARCH_URL + encodeURIComponent(text);
  if (LOCALHOST.test(text) || IPV4.test(text)) return `http://${text}`;
  if (DOMAIN.test(text)) return `https://${text}`;
  return SEARCH_URL + encodeURIComponent(text);
}
