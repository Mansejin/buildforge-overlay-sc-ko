/**
 * src/shared/types.ts
 * Single source of truth for project types shared across the Rust backend
 * and the TypeScript renderer. The OverlayAPI interface here is the
 * canonical IPC contract; src-tauri/src/commands.rs implements it and the
 * renderer consumes it via src/renderer/api.ts.
 */

export type Race = "Terran" | "Protoss" | "Zerg";
export type Opponent = "Terran" | "Protoss" | "Zerg" | "Random";
export type Matchup = `${"T" | "P" | "Z"}v${"T" | "P" | "Z" | "R"}`;
export type Difficulty = "beginner" | "intermediate" | "advanced" | null;
export type SourceName = "Liquipedia" | "Manual" | string;

export interface Build {
  id: string;
  race: Race;
  opponent: Opponent;
  matchup: Matchup;
  name: string;
  variantOf: string | null;
  tags: string[];
  difficulty: Difficulty;
  sourceName: SourceName;
  sourceUrl: string;
  sourcePageTitle: string | null;
  notes: string;
  userNotes: string;
  customEdited: boolean;
  favorite: boolean;
  recentlyUsedAt: string | null;
  revisionId: number | null;
  lastImportedAt: string | null;
  lastCheckedAt: string | null;
  counters: string[];
  counteredBy: string[];
  steps: string[];
}

export interface BuildsData {
  version: number;
  lastUpdated: string;
  builds: Build[];
}

export type ViewMode = "manager" | "overlay";
export type WindowSnapPreset = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  date: string | null;
  body: string | null;
}

export interface AppUpdateCheckResult {
  available: boolean;
  update: AppUpdateInfo | null;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export interface Settings {
  version?: number;
  liquipediaUserAgent: string;
  rateLimitMs: number;
  compactOverlay: boolean;
  overlayOpacity: number;
  overlayClickThrough: boolean;
  checkAppUpdatesOnLaunch: boolean;
  appUpdateCheckIntervalHours: number;
  lastAppUpdateCheckAt: string | null;
  pageSize: number;
  defaultRace: Race;
  /** v2.0+: which view the app booted into / should re-open with. */
  lastView: ViewMode;
  /** v2.0+: remembered window dimensions per mode. */
  managerWindowSize: WindowSize;
  overlayWindowSize: WindowSize;
  /** v2.2+: remembered window position per mode. */
  managerWindowPosition: WindowPosition | null;
  overlayWindowPosition: WindowPosition | null;
}

export interface UserDataPaths {
  userBuildsPath: string;
  settingsPath: string;
  userData: string;
}

export type HotkeyAction =
  | "race-terran"
  | "race-protoss"
  | "race-zerg"
  | "opp-terran"
  | "opp-zerg"
  | "opp-protoss"
  | "opp-random"
  | "next-build"
  | "prev-build"
  | "next-page"
  | "prev-page"
  | "first-page"
  | "toggle-favorite"
  | "toggle-compact"
  | "toggle-window"
  | "toggle-mode"
  | "toggle-click-through"
  | "toggle-reposition";

export interface OverlayAPI {
  getBuilds(): Promise<BuildsData>;
  saveBuilds(builds: BuildsData): Promise<BuildsData>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  backupData(): Promise<string>;
  openDataFolder(): void;
  getUserPaths(): Promise<UserDataPaths>;
  close(): void;
  toggleWindow(): void;
  setOpacity(value: number): void;
  setClickThrough(enabled: boolean): void;
  snapWindow(preset: WindowSnapPreset): Promise<Settings>;
  toggleOverlayRepositionMode(): Promise<{
    active: boolean;
    clickThroughEnabled: boolean;
  }>;
  checkForAppUpdate(): Promise<AppUpdateCheckResult>;
  installAppUpdate(): Promise<boolean>;
  openExternal(url: string): void;
  onHotkey(callback: (action: HotkeyAction) => void): void;
}
