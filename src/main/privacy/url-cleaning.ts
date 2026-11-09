// Limpeza de URL: tira parâmetros de rastreamento dos links abertos (só navegação
// principal — nunca em chamadas de API, que podem precisar deles).

/** Nomes exatos. */
const PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'wickedid', 'rb_clickid', 's_cid', 'ef_id', '_openstat',
  'spm', 'scm', 'srsltid', 'gad_source', 'epik', 'trk', 'trkCampaign', 'sc_cid', 'ncid',
]);

/** Prefixos (utm_source, utm_medium, …; pk_campaign, …). */
const PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_', 'matomo_'];

const isTracking = (name: string) => {
  const n = name.toLowerCase();
  return PARAMS.has(n) || PREFIXES.some((p) => n.startsWith(p));
};

/** URL sem os parâmetros de rastreamento, ou null se não havia nenhum. */
export function cleanUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.search) return null;
  const keep = [...u.searchParams].filter(([k]) => !isTracking(k));
  if (keep.length === [...u.searchParams].length) return null;
  u.search = keep.length ? new URLSearchParams(keep).toString() : '';
  return u.toString();
}
