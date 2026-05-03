/**
 * src/renderer/index.ts
 * Renderer entry point bundled by esbuild into one ESM file. Boots the
 * overlay: loads builds + settings via the preload bridge, wires every
 * tab/module's event handlers, mounts the global "/" search hotkey, hooks
 * up the main-process hotkey channel, and shows a fatal red banner if
 * boot fails.
 */
import { api } from "./api.js";
import { dom } from "./dom.js";
import { currentBuild, loadLocalState, setOpponent, setRace, store } from "./state.js";
import { bindOverlayEvents, renderOverlay } from "./overlay.js";
import { bindManagerListEvents, renderManagerList } from "./manager.js";
import { bindEditTabEvents, loadBuildIntoForm } from "./edit-tab.js";
import { bindSettingsTabEvents, loadSettingsIntoForm } from "./settings-tab.js";
import { makeHotkeyHandler } from "./hotkeys.js";
import { applyModeToDom, bindModeToggle, setMode } from "./mode.js";
import { refreshCatalogStatusBanner } from "./catalog-status.js";
import { toastError, toastWarn } from "./toast.js";
import type { Build, Settings } from "../shared/types.js";

console.info("[bw-overlay] renderer booted");

function showFatal(message: string): void {
  let banner = document.getElementById("fatalBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "fatalBanner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;background:#7a1f1f;color:#fff;padding:12px 16px;font:14px Segoe UI,sans-serif;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,.5);";
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<strong>Renderer error:</strong> ${String(message)}<br><small>Press F12 to open DevTools for details.</small>`;
}

async function saveData(): Promise<void> {
  try {
    store.data = await api.saveBuilds(store.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toastError(`Save failed: ${message}`);
    throw err;
  }
}

async function persistFavorite(_build: Build): Promise<void> {
  try {
    store.data = await api.saveBuilds(store.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toastError(`Could not save favorite: ${message}`);
  }
}

async function persistSettings(partial: Partial<Settings>): Promise<void> {
  try {
    store.settings = await api.saveSettings({ ...store.settings, ...partial });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toastError(`Settings save failed: ${message}`);
  }
}

function openExternal(url: string): void {
  if (url) api.openExternal(url);
}

function openManager(): void {
  store.selectedManagerBuildId = currentBuild()?.id ?? store.selectedManagerBuildId;
  loadBuildIntoForm(currentBuild());
  loadSettingsIntoForm();
  renderManagerList();
  void setMode("manager");
}

function bindGlobalKeys(): void {
  document.addEventListener("keydown", (e) => {
    const target = e.target as Element | null;
    const tag = target?.tagName?.toLowerCase() ?? "";
    const inField = ["input", "textarea", "select"].includes(tag);
    if (e.key === "/" && !inField && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      dom.buildSearch.focus();
    }
  });
}

function shouldRunLaunchUpdateCheck(settings: Settings): boolean {
  if (!settings.checkAppUpdatesOnLaunch) return false;
  const hours = Math.max(1, Math.min(168, Number(settings.appUpdateCheckIntervalHours) || 24));
  const intervalMs = hours * 60 * 60 * 1000;
  const last = settings.lastAppUpdateCheckAt ? Date.parse(settings.lastAppUpdateCheckAt) : NaN;
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= intervalMs;
}

async function maybeCheckForAppUpdates(
  persistSettingsFn: (partial: Partial<Settings>) => Promise<void>
): Promise<void> {
  if (!shouldRunLaunchUpdateCheck(store.settings)) return;
  const nowIso = new Date().toISOString();
  await persistSettingsFn({ lastAppUpdateCheckAt: nowIso });
  try {
    const result = await api.checkForAppUpdate();
    if (!result.available || !result.update) return;
    toastWarn(`App update ${result.update.version} is available.`);
    const shouldInstall = window.confirm(
      `Update ${result.update.version} is available. Install now?`
    );
    if (!shouldInstall) return;
    await api.installAppUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("app update check failed:", message);
    if (message.toLowerCase().includes("pubkey")) {
      toastWarn("Update check unavailable (updater key missing).");
    }
  }
}

async function boot(): Promise<void> {
  loadLocalState();
  try {
    store.data = await api.getBuilds();
    store.settings = await api.getSettings();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dom.buildName.textContent = "Error loading data";
    dom.buildNotes.hidden = false;
    dom.buildNotes.textContent = message;
    showFatal(`Failed to load data from main process: ${message}`);
    return;
  }

  if (!store.state.race) store.state.race = store.settings.defaultRace || "Protoss";
  if (!currentBuild()) {
    const first =
      store.data.builds.find((b) => b.race === store.state.race) || store.data.builds[0];
    if (first) {
      setRace(first.race);
      setOpponent(first.opponent);
      store.state.buildId = first.id;
    }
  }
  store.selectedManagerBuildId = store.state.buildId || store.data.builds[0]?.id || null;

  bindOverlayEvents({
    openExternal,
    toggleCompact: async () => {
      store.settings.compactOverlay = !store.settings.compactOverlay;
      await persistSettings({ compactOverlay: store.settings.compactOverlay });
      renderOverlay();
    },
    persistFavorite
  });

  bindManagerListEvents(saveData);
  bindEditTabEvents(saveData, openExternal);
  bindSettingsTabEvents();
  bindModeToggle();
  dom.manageButton.addEventListener("click", openManager);
  bindGlobalKeys();
  api.onHotkey(makeHotkeyHandler({ persistSettings, persistFavorite }));
  api.setOpacity(Number(store.settings.overlayOpacity) || 1);
  // Apply the mode the Rust side booted us into. This is local state only;
  // the actual window chrome was already configured by lib.rs::set_mode.
  applyModeToDom(store.settings.lastView ?? "manager");
  api.setClickThrough(
    (store.settings.lastView ?? "manager") === "overlay" && !!store.settings.overlayClickThrough
  );
  loadSettingsIntoForm();
  loadBuildIntoForm(currentBuild());
  renderManagerList();
  renderOverlay();
  refreshCatalogStatusBanner();
  void maybeCheckForAppUpdates(persistSettings);
}

boot().catch((err: unknown) => {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  if (dom.buildName) {
    dom.buildName.textContent = "Error loading overlay";
    dom.buildNotes.hidden = false;
    dom.buildNotes.textContent = message;
  }
  showFatal(`Boot failed: ${message}`);
});
