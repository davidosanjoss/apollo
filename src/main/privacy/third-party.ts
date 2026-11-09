// Quem é "terceiro" para fins de cookies. Sites da mesma empresa que dependem uns
// dos outros para login contam como uma parte só (como os "Related Website Sets"
// do Chrome) — senão Outlook, Teams, Gmail e YouTube deslogam.
import { siteOf } from './rules';

const PARTY_GROUPS: string[][] = [
  // Microsoft: Outlook/Office/Teams/OneDrive e o login (Entra ID / conta Microsoft).
  ['microsoft.com', 'microsoftonline.com', 'live.com', 'live.net', 'outlook.com', 'office.com', 'office365.com',
    'office.net', 'microsoft365.com', 'cloud.microsoft', 'sharepoint.com', 'onedrive.com', 'msauth.net',
    'msftauth.net', 'msidentity.com', 'skype.com', 'teams.live.com', 'windows.net', 'azure.com', 'sfx.ms',
    'onestore.ms', 'msecnd.net', 'aka.ms', 'microsoftstream.com', 'bing.com', 'msn.com', 'xbox.com'],
  // Google: contas, Gmail/Drive/Docs, YouTube. (Domínios de anúncio ficam de fora.)
  ['google.com', 'google.com.br', 'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'youtube.com',
    'youtube-nocookie.com', 'ytimg.com', 'ggpht.com', 'gmail.com', 'withgoogle.com', 'googlevideo.com', 'goo.gl'],
];

const GROUP_OF = new Map<string, number>();
PARTY_GROUPS.forEach((g, i) => g.forEach((s) => GROUP_OF.set(s, i)));

export function sameParty(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = GROUP_OF.get(a);
  return ga !== undefined && ga === GROUP_OF.get(b);
}

/** A requisição vai para um site diferente (e de outra empresa) da página? */
export function isThirdParty(requestUrl: string, firstPartyUrl: string | null): boolean {
  const req = siteOf(requestUrl);
  const first = siteOf(firstPartyUrl);
  if (!req || !first) return false; // sem como saber: não interfere
  return !sameParty(req, first);
}
