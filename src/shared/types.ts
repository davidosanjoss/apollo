// Contrato entre a UI (renderer, sem privilégios) e o processo principal.
// A UI só recebe snapshots de estado e envia comandos; quem decide é o main.

export interface WorkspaceInfo {
  id: string;
  name: string;
  color: string;
  home: string;
  /** Minutos sem uso para hibernar abas (0 = nunca). */
  hibernateAfterMin: number;
  /** Padrões do workspace (null = segue o global). */
  privacy: Record<PrivacyFeature, boolean | null>;
  /** Sessão só em memória; some ao fechar o Apollo. */
  temporary: boolean;
}

/** Opções de "hibernar abas inativas após" (minutos; 0 = nunca). */
export const HIBERNATE_OPTIONS_MIN = [0, 5, 15, 30, 60, 120, 240] as const;

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Ainda sem página carregada (será carregada ao ativar). */
  dormant: boolean;
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
  /** null = sem página carregada (hibernada). */
  mb: number | null;
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

export type DnsMode = 'secure' | 'automatic' | 'off';

export interface SettingsInfo {
  dns: { mode: DnsMode; dohUrl: string | null; provider: string | null };
  dnsTest: { status: 'idle' | 'testing' | 'ok' | 'fail'; ms?: number; error?: string };
  /** Camada global de privacidade (null = padrão do Apollo). */
  privacy: Record<PrivacyFeature, boolean | null>;
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
}

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
  | { type: 'settings:dns'; mode: DnsMode; dohUrl: string | null }
  | { type: 'settings:test-dns' }
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
  | { type: 'workspace:create'; name: string; color: string; home: string; hibernateAfterMin?: number; temporary?: boolean }
  | { type: 'workspace:update'; workspaceId: string; name: string; color: string; home: string; hibernateAfterMin?: number }
  | { type: 'workspace:delete'; workspaceId: string }
  | { type: 'layout:bounds'; x: number; y: number; width: number; height: number }
  | { type: 'layout:overlay'; open: boolean }
  | { type: 'permission:answer'; promptId: string; decision: PermissionDecision; remember: boolean }
  | { type: 'permission:set'; origin: string; kind: PermissionKind; decision: PermissionDecision | null }
  | { type: 'update:download' }
  | { type: 'update:install' };

/** Eventos pontuais do main para a UI (além do snapshot de estado). */
export type UiEvent =
  | { type: 'focus-address' }
  /** Abrir o diálogo de nome/cor do grupo (ex.: logo depois de criá-lo). */
  | { type: 'edit-group'; groupId: string };

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
