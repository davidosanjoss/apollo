// Texto para busca (puro).

/** Minúsculas e sem acentos: "Configurações" ≈ "configuracoes". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
