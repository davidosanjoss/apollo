// Corretor ortográfico das páginas. O Chromium baixa o dicionário (uma vez, sem dados
// do usuário) dos servidores do Google; "off" evita até isso.
import type { SpellcheckMode } from '../shared/types';

export const SPELLCHECK_MODES: SpellcheckMode[] = ['pt-en', 'pt', 'off'];

export function spellcheckLanguages(mode: SpellcheckMode): string[] {
  return mode === 'pt-en' ? ['pt-BR', 'en-US'] : mode === 'pt' ? ['pt-BR'] : [];
}

export function parseSpellcheck(v: string | null): SpellcheckMode {
  return (SPELLCHECK_MODES as string[]).includes(v ?? '') ? (v as SpellcheckMode) : 'pt-en';
}
