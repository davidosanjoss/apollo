// Módulos do navegador que podem ser ligados/desligados (Configurações → Módulos).
// Anúncios/rastreadores/cookies/limpeza de links não estão aqui: já têm as camadas
// de privacidade (global → workspace → site → aba).
import type { ModuleId } from '../shared/types';

export interface ModuleDef { id: ModuleId; name: string; description: string }

export const MODULES: ModuleDef[] = [
  { id: 'gpc', name: 'Global Privacy Control', description: 'Envia o sinal "não venda/compartilhe meus dados" (Sec-GPC) a todos os sites.' },
  { id: 'cosmetics', name: 'Filtros cosméticos e scriptlets', description: 'Esconde espaços de anúncio e bloqueia anúncios dentro de sites como o YouTube.' },
  { id: 'vaultSave', name: 'Oferecer salvar senhas', description: 'Ao fazer login num site, pergunta se quer salvar/atualizar no Bitwarden.' },
  { id: 'hibernation', name: 'Hibernação automática', description: 'Libera a memória de abas paradas (as regras de cada workspace continuam valendo).' },
  { id: 'customizations', name: 'Personalizações', description: 'Aplica o seu CSS e JavaScript nos sites escolhidos.' },
];

/** Estado salvo (ids ausentes = ligado). */
export function parseModules(json: string | null): Record<ModuleId, boolean> {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(json ?? '{}') ?? {}; } catch { /* padrão */ }
  return Object.fromEntries(MODULES.map((m) => [m.id, saved[m.id] !== false])) as Record<ModuleId, boolean>;
}
