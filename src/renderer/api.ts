/**
 * src/renderer/api.ts
 * Implementation of the OverlayAPI contract for the renderer. Every method
 * here calls a Rust `#[tauri::command]` via `invoke()` or subscribes to a
 * backend event via `listen()`. Other renderer modules import `api` from
 * this file.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  BuildsData,
  HotkeyAction,
  OverlayAPI,
  Settings,
  UserDataPaths,
  WindowSnapPreset
} from "../shared/types.js";

function fireAndForget<T>(promise: Promise<T>): void {
  promise.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[overlayAPI] fire-and-forget failed:", message);
  });
}

export const api: OverlayAPI = {
  getBuilds: () => invoke<BuildsData>("builds_get"),
  saveBuilds: (builds: BuildsData) => invoke<BuildsData>("builds_save", { builds }),

  getSettings: () => invoke<Settings>("settings_get"),
  saveSettings: (settings: Partial<Settings>) => invoke<Settings>("settings_save", { settings }),
  checkForAppUpdate: () => invoke("app_update_check"),
  installAppUpdate: () => invoke("app_update_install"),

  backupData: () => invoke<string>("data_backup"),
  openDataFolder: () => fireAndForget(invoke<void>("data_open_folder")),
  getUserPaths: () => invoke<UserDataPaths>("data_user_paths"),

  close: () => fireAndForget(invoke<void>("window_close")),
  toggleWindow: () => fireAndForget(invoke<void>("window_toggle")),
  setOpacity: (value: number) => fireAndForget(invoke<void>("window_set_opacity", { value })),
  setClickThrough: (enabled: boolean) =>
    fireAndForget(invoke<void>("window_set_click_through", { enabled })),
  snapWindow: (preset: WindowSnapPreset) => invoke<Settings>("window_snap", { preset }),
  toggleOverlayRepositionMode: () =>
    invoke<{ active: boolean; clickThroughEnabled: boolean }>("window_toggle_reposition"),
  openExternal: (url: string) => fireAndForget(invoke<void>("external_open", { url })),

  onHotkey: (callback: (action: HotkeyAction) => void) => {
    fireAndForget(listen<HotkeyAction>("hotkey", (event) => callback(event.payload)));
  }
};
