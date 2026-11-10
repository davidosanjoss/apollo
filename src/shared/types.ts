// Contrato entre a UI (renderer, sem privilégios) e o processo principal.
// A UI só recebe snapshots de estado e envia comandos; quem decide é o main.

export interface WorkspaceInfo {
  id: string;
  name: string;
  color: string;
  home: string;
  /** Minutos sem uso para hibernar abas (0 = nunca, -1 = ao sair da aba). */
  hibernateAfterMin: number;
  /** Quando o workspace não está na tela (null = mesma regra, -1 = ao sair dele). */
  hiddenHibernateMin: number | null;
  /** Padrões do workspace (null = segue o global). */
  privacy: Record<PrivacyFeature, boolean | null>;
  /** Sessão só em memória; some ao fechar o Apollo. */
  temporary: boolean;
}

/** Opções de "hibernar abas inativas após" (minutos; 0 = nunca). */
/** Hibernar abas paradas após (min): 0 = nunca, -1 = ao sair da aba. */
export const HIBERNATE_OPTIONS_MIN = [-1, 0, 5, 15, 30, 60, 120, 240] as const;
/** Workspace fora da tela (min): null = mesma regra, -1 = ao sair do workspace. */
export const HIDDEN_HIBERNATE_OPTIONS_MIN = [null, -1, 5, 10, 30, 60] as const;
/** Painel fechado (min): null = sempre ativo, 0 = ao fechar. */
export const PANEL_HIBERNATE_OPTIONS_MIN = [null, 0, 30, 120, 480] as const;

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Ainda sem página carregada (será carregada ao ativar). Página inicial nunca conta como "dormindo". */
  dormant: boolean;
  /** Tem página (processo) carregada. Página inicial sem página = desenhada pela própria interface. */
  live: boolean;
  pinned: boolean;
  /** Nunca hiberna. */
  keepAwake: boolean;
  groupId: string | null;
}

export interface GroupInfo {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

/** Cores de grupo (as mesmas ideias de Chrome/Opera). */
export const GROUP_COLORS = ['#8a8f98', '#4c8bf5', '#e5534b', '#e3b341', '#3fb950', '#db61a2', '#a371f7', '#39c5cf', '#f0883e'] as const;

export type PermissionKind =
  | 'media-video'
  | 'media-audio'
  | 'geolocation'
  | 'notifications'
  | 'clipboard-read'
  | 'display-capture'
  | 'midi'
  | 'open-external'
  | 'storage-access';

export type PermissionDecision = 'allow' | 'deny';

export interface PermissionPrompt {
  id: string;
  tabId: string;
  origin: string;
  kinds: PermissionKind[];
}

export interface SitePermissions {
  origin: string;
  entries: { kind: PermissionKind; decision: PermissionDecision | null }[];
}

export type UpdateStatus =
  | { stage: 'available'; version: string }
  | { stage: 'downloading'; percent: number }
  | { stage: 'downloaded'; version: string }
  | { stage: 'error' };

export interface MemoryTab {
  id: string;
  workspaceId: string;
  title: string;
  favicon: string | null;
  /** null = sem página carregada (hibernada, ou página inicial desenhada pela interface). */
  mb: number | null;
  home: boolean;
  visible: boolean;
  keepAwake: boolean;
  playing: boolean;
}

/** Só existe enquanto o monitor de memória está aberto (fechado = custo zero). */
export interface MemoryReport {
  totalMb: number;
  /** Navegador, GPU, rede etc. */
  otherMb: number;
  /** 0 = sem limite. */
  limitMb: number;
  tabs: MemoryTab[];
}

/** Opções do limite de memória do Apollo (MB; 0 = sem limite). */
export const MEMORY_LIMIT_OPTIONS_MB = [0, 1024, 2048, 3072, 4096, 6144, 8192] as const;

// ------------------------------------------------------------ privacidade

export type PrivacyFeature = 'ads' | 'trackers' | 'thirdPartyCookies' | 'urlCleaning';
export type PrivacyToggles = Record<PrivacyFeature, boolean>;
/** Camada de onde veio a decisão (default = padrão do Apollo). */
export type PrivacyLevel = 'tab' | 'site' | 'workspace' | 'global' | 'default';

export const PRIVACY_LABELS: Record<PrivacyFeature, string> = {
  ads: 'Bloquear anúncios',
  trackers: 'Bloquear rastreadores',
  thirdPartyCookies: 'Bloquear cookies de terceiros',
  urlCleaning: 'Limpar rastreio dos links',
};

/** Proteção do site da aba ativa (painel ⚙). */
export interface SitePrivacy {
  site: string;
  toggles: PrivacyToggles;
  source: Record<PrivacyFeature, PrivacyLevel>;
  /** Regras salvas para este site neste workspace (null = segue o workspace). */
  siteRules: Record<PrivacyFeature, boolean | null>;
  /** Proteção pausada só nesta aba (até fechar). */
  tabPaused: boolean;
  blocked: { ads: number; trackers: number };
}

/** Estado do cofre do Bitwarden (nunca contém segredos). */
export interface VaultStatusInfo {
  status: 'disconnected' | 'locked' | 'unlocked';
  email: string | null;
  server: string | null;
  count: number;
  lastSync: number | null;
  lockAfterMin: number;
  busy: boolean;
  error: string | null;
  /** Há chaveiro do sistema: dá para lembrar a conexão entre reinícios. */
  canRemember: boolean;
}

export type DnsMode = 'secure' | 'automatic' | 'off';

export type SpellcheckMode = 'pt-en' | 'pt' | 'off';

export interface SettingsInfo {
  dns: { mode: DnsMode; dohUrl: string | null; provider: string | null };
  dnsTest: { status: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string };
  /** Camada global de privacidade (null = padrão do Apollo). */
  privacy: Record<PrivacyFeature, boolean | null>;
  spellcheck: SpellcheckMode;
}

export interface UiState {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  tabs: TabInfo[];
  groups: GroupInfo[];
  activeTabId: string | null;
  permissionPrompt: PermissionPrompt | null;
  /** Permissões do site da aba ativa (para o painel ao lado da barra de endereço). */
  sitePermissions: SitePermissions | null;
  sitePrivacy: SitePrivacy | null;
  update: UpdateStatus | null;
  memory: MemoryReport | null;
  settings: SettingsInfo;
  vault: VaultStatusInfo;
  /** Logins do Bitwarden para o site da aba ativa (null = página não é web ou cofre desconectado). */
  vaultSite: { status: 'locked' | 'unlocked'; count: number } | null;
  /** Barra "salvar/atualizar senha" para a aba ativa (a senha nunca vem para a UI). */
  savePrompt: { id: string; site: string; username: string | null; mode: 'save' | 'update' | 'locked' } | null;
  generator: { length: number; symbols: boolean };
  /** Abas de todos os workspaces, só enquanto a paleta está aberta (fechada = custo zero). */
  paletteTabs: { id: string; title: string; url: string; workspaceId: string }[] | null;
  panels: PanelInfo[];
  /** Painel aberto (só um por vez). */
  activePanelId: string | null;
  modules: ModuleInfo[];
  customizations: CustomizationInfo[];
  /** Pedido de compartilhar tela aguardando a escolha do usuário. */
  screenPicker: ScreenPickerInfo | null;
  /** Favoritos do workspace ativo, em ordem. */
  bookmarks: BookmarkInfo[];
  /** Favorito da página da aba ativa (estrela acesa), ou null. */
  activeBookmarkId: string | null;
}

export interface BookmarkInfo {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
}

export interface ScreenSource {
  id: string;
  name: string;
  /** system = seletor do próprio sistema (Wayland: tela ou janela). */
  kind: 'screen' | 'window' | 'tab' | 'system';
  /** Miniatura (data: URL) ou null. */
  thumbnail: string | null;
}

export interface ScreenPickerInfo {
  id: string;
  origin: string;
  audioRequested: boolean;
  /** Áudio do sistema (loopback) só existe no Windows; áudio de aba em qualquer sistema. */
  systemAudio: boolean;
  sources: ScreenSource[];
}

export interface PanelInfo {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  favicon: string | null;
  width: number;
  mobile: boolean;
  /** Já carregado (continua vivo mesmo fechado, para mensagens chegarem). */
  loaded: boolean;
  /** Hibernar quando fechado: null = sempre ativo, 0 = ao fechar, N min. */
  hibernateMin: number | null;
}

export type ModuleId = 'gpc' | 'cosmetics' | 'vaultSave' | 'hibernation' | 'customizations';

export interface ModuleInfo { id: ModuleId; name: string; description: string; enabled: boolean }

export interface CustomizationInfo { id: string; name: string; sites: string; css: string; js: string; enabled: boolean }

/** Largura do painel (px): ajustada arrastando a borda; salva por painel. */
export const PANEL_MIN_WIDTH = 260;
export const PANEL_MAX_WIDTH = 1600;
export const PANEL_DEFAULT_WIDTH = 420;

/** Sugestões para o diálogo de novo painel. */
export const PANEL_SUGGESTIONS: { name: string; url: string; mobile?: boolean }[] = [
  { name: 'WhatsApp', url: 'https://web.whatsapp.com/' },
  { name: 'Telegram', url: 'https://web.telegram.org/' },
  { name: 'Teams', url: 'https://teams.microsoft.com/' },
  { name: 'Outlook Calendário', url: 'https://outlook.office.com/calendar/' },
  { name: 'Google Agenda', url: 'https://calendar.google.com/' },
  { name: 'Spotify', url: 'https://open.spotify.com/' },
];

/** Tamanhos oferecidos pelo gerador de senhas. */
export const GENERATOR_LENGTHS = [12, 16, 20, 24, 32, 48, 64] as const;

export type UiCommand =
  | { type: 'tab:new'; url?: string }
  | { type: 'tab:reopen' }
  | { type: 'tab:close'; tabId: string }
  | { type: 'tab:activate'; tabId: string }
  | { type: 'tab:navigate'; url: string }
  | { type: 'tab:back' }
  | { type: 'tab:forward' }
  | { type: 'tab:reload' }
  | { type: 'tab:focus' }
  /** Arrastar: índice final e grupo de destino (null = sem grupo; ausente = mantém). */
  | { type: 'tab:move'; tabId: string; index: number; groupId?: string | null }
  | { type: 'tab:pin'; tabId: string; pinned: boolean }
  | { type: 'tab:keep-awake'; tabId: string; keepAwake: boolean }
  | { type: 'tab:duplicate'; tabId: string }
  | { type: 'tab:hibernate'; tabId: string }
  /** Mostra a aba, trocando de workspace se preciso (monitor de memória). */
  | { type: 'tab:reveal'; tabId: string }
  | { type: 'memory:toggle'; open: boolean }
  /** Regra de privacidade: site = site da aba ativa no workspace ativo; null = volta a herdar. */
  | { type: 'privacy:set'; scope: 'global' | 'workspace' | 'site'; feature: PrivacyFeature; enabled: boolean | null; workspaceId?: string }
  /** Pausa toda a proteção só na aba ativa, até ela fechar. */
  | { type: 'privacy:pause-tab'; paused: boolean }
  /** Volta o site da aba ativa ao padrão (remove todas as regras de proteção dele). */
  | { type: 'privacy:reset-site' }
  /** Menu nativo do escudo da barra de endereço em (x, y). */
  | { type: 'privacy:menu'; x: number; y: number }
  | { type: 'settings:dns'; mode: DnsMode; dohUrl: string | null }
  // Bitwarden. Segredos vão só neste sentido (UI → main) e nunca voltam no estado.
  | { type: 'vault:connect'; server: string; clientId: string; clientSecret: string; password: string }
  | { type: 'vault:unlock'; password: string }
  | { type: 'vault:lock' }
  | { type: 'vault:sync' }
  | { type: 'vault:disconnect' }
  | { type: 'vault:lock-after'; minutes: number }
  /** Menu da chave na barra de endereço (logins do site da aba ativa). */
  | { type: 'vault:menu'; x: number; y: number }
  | { type: 'vault:fill'; itemId: string }
  | { type: 'vault:copy'; itemId: string; what: 'username' | 'password' | 'totp' }
  | { type: 'vault:open' }
  | { type: 'vault:autofill' }
  | { type: 'palette:toggle'; open: boolean }
  | { type: 'panel:add'; url: string; workspaceId: string; mobile: boolean }
  | { type: 'panel:toggle'; panelId: string }
  | { type: 'panel:remove'; panelId: string }
  | { type: 'panel:set'; panelId: string; width?: number; mobile?: boolean; hibernateMin?: number | null }
  | { type: 'panel:hibernate'; panelId: string }
  | { type: 'panel:bounds'; x: number; y: number; width: number; height: number }
  | { type: 'panel:menu'; panelId: string; x: number; y: number }
  | { type: 'module:set'; moduleId: ModuleId; enabled: boolean }
  /** Marca a página da aba ativa como favorita (no workspace dela). */
  | { type: 'bookmark:add' }
  | { type: 'bookmark:update'; bookmarkId: string; title: string; url: string }
  | { type: 'bookmark:remove'; bookmarkId: string }
  | { type: 'bookmark:move'; bookmarkId: string; index: number }
  /** Abrir o favorito: na aba ativa se ela estiver na página inicial, senão numa nova aba. */
  | { type: 'bookmark:open'; bookmarkId: string; newTab?: boolean }
  /** Escolha no seletor de compartilhar tela (sourceId null = cancelar). */
  | { type: 'screen:pick'; requestId: string; sourceId: string | null; audio: boolean }
  /** Cria (sem id) ou edita uma personalização. */
  | { type: 'custom:save'; id?: string; name: string; sites: string; css: string; js: string; enabled: boolean }
  | { type: 'custom:delete'; id: string }
  | { type: 'vault:save-answer'; promptId: string; action: 'save' | 'dismiss' | 'never' }
  /** Gerar senha: preencher os campos de senha novos da página, ou copiar. */
  | { type: 'vault:generate'; fill: boolean }
  | { type: 'vault:generator'; length: number; symbols: boolean }
  | { type: 'settings:test-dns' }
  | { type: 'settings:spellcheck'; mode: SpellcheckMode }
  | { type: 'settings:memory-limit'; mb: number }
  | { type: 'tab:hibernate-others'; tabId: string }
  | { type: 'tab:close-others'; tabId: string }
  | { type: 'tab:close-right'; tabId: string }
  /** Abre o menu de contexto nativo da aba em (x, y) da janela. */
  | { type: 'tab:menu'; tabId: string; x: number; y: number }
  | { type: 'group:create'; tabId: string }
  | { type: 'group:add'; tabId: string; groupId: string | null }
  | { type: 'group:update'; groupId: string; name: string; color: string }
  | { type: 'group:collapse'; groupId: string; collapsed: boolean }
  | { type: 'group:ungroup'; groupId: string }
  | { type: 'group:close'; groupId: string }
  | { type: 'group:new-tab'; groupId: string }
  | { type: 'group:menu'; groupId: string; x: number; y: number }
  | { type: 'workspace:switch'; workspaceId: string }
  | { type: 'workspace:create'; name: string; color: string; home: string; hibernateAfterMin?: number; hiddenHibernateMin?: number | null; temporary?: boolean }
  | { type: 'workspace:update'; workspaceId: string; name: string; color: string; home: string; hibernateAfterMin?: number; hiddenHibernateMin?: number | null }
  | { type: 'workspace:delete'; workspaceId: string }
  | { type: 'layout:bounds'; x: number; y: number; width: number; height: number }
  | { type: 'layout:overlay'; open: boolean }
  | { type: 'permission:answer'; promptId: string; decision: PermissionDecision; remember: boolean }
  | { type: 'permission:set'; origin: string; kind: PermissionKind; decision: PermissionDecision | null }
  /** Menu nativo da engrenagem (permissões do site da aba ativa) em (x, y). */
  | { type: 'permission:menu'; x: number; y: number }
  | { type: 'update:download' }
  | { type: 'update:install' };

/** Eventos pontuais do main para a UI (além do snapshot de estado). */
export type UiEvent =
  | { type: 'focus-address' }
  /** Abrir a paleta de comandos (Ctrl+K com o foco na página). */
  | { type: 'open-palette' }
  /** Abrir o diálogo do cofre (ex.: "Desbloquear…" no menu da chave). */
  | { type: 'open-vault' }
  /** Abrir o diálogo de nome/cor do grupo (ex.: logo depois de criá-lo). */
  | { type: 'edit-group'; groupId: string }
  /** Abrir o diálogo do favorito (Ctrl+D: acabou de marcar ou já estava marcado). */
  | { type: 'edit-bookmark'; bookmarkId: string };

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  'media-video': 'Câmera',
  'media-audio': 'Microfone',
  geolocation: 'Localização',
  notifications: 'Notificações',
  'clipboard-read': 'Ler área de transferência',
  'display-capture': 'Compartilhar tela',
  midi: 'Dispositivos MIDI',
  'open-external': 'Abrir aplicativos externos',
  'storage-access': 'Acesso a cookies entre sites',
};

export const APOLLO_HOME = 'apollo://home';
export const isHomeUrl = (url: string | null | undefined): boolean => !url || url.startsWith('apollo://home');
