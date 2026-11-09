// Contrato entre a UI (renderer, sem privilégios) e o processo principal.
// A UI só recebe snapshots de estado e envia comandos; quem decide é o main.

export interface WorkspaceInfo {
  id: string;
  name: string;
  color: string;
  home: string;
}

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
}

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

export interface UiState {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  tabs: TabInfo[];
  activeTabId: string | null;
  permissionPrompt: PermissionPrompt | null;
  /** Permissões do site da aba ativa (para o painel ao lado da barra de endereço). */
  sitePermissions: SitePermissions | null;
  update: UpdateStatus | null;
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
  | { type: 'workspace:switch'; workspaceId: string }
  | { type: 'workspace:create'; name: string; color: string; home: string }
  | { type: 'workspace:update'; workspaceId: string; name: string; color: string; home: string }
  | { type: 'workspace:delete'; workspaceId: string }
  | { type: 'layout:bounds'; x: number; y: number; width: number; height: number }
  | { type: 'layout:overlay'; open: boolean }
  | { type: 'permission:answer'; promptId: string; decision: PermissionDecision; remember: boolean }
  | { type: 'permission:set'; origin: string; kind: PermissionKind; decision: PermissionDecision | null }
  | { type: 'update:download' }
  | { type: 'update:install' };

/** Eventos pontuais do main para a UI (além do snapshot de estado). */
export type UiEvent = { type: 'focus-address' };

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
