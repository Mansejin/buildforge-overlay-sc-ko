/**
 * src/renderer/settings-tab.ts
 * Manager > Settings tab: load/save overlay behavior, opacity, page size,
 * and default race. Persisted via the main-process settings.json.
 */
import { api } from "./api.js";
import { dom } from "./dom.js";
import { store } from "./state.js";
import { toastError, toastOk, toastWarn } from "./toast.js";
import { renderOverlay } from "./overlay.js";
import { applyModeToDom, getMode } from "./mode.js";
import type { AppUpdateInfo, Race, Settings, WindowSnapPreset } from "../shared/types.js";

let pendingAppUpdate: AppUpdateInfo | null = null;

function setAppUpdateStatus(text: string, canInstall = false): void {
  dom.appUpdateStatus.textContent = text;
  dom.installAppUpdateButton.hidden = !canInstall;
}

async function checkAppUpdateNow(): Promise<void> {
  setAppUpdateStatus("Checking for updates...");
  try {
    const result = await api.checkForAppUpdate();
    if (result.available && result.update) {
      pendingAppUpdate = result.update;
      setAppUpdateStatus(
        `Update ${result.update.version} available (current ${result.update.currentVersion}).`,
        true
      );
      toastWarn(`Update ${result.update.version} is available.`);
      return;
    }
    pendingAppUpdate = null;
    setAppUpdateStatus("You are on the latest version.");
    toastOk("No app update available.");
  } catch (err) {
    pendingAppUpdate = null;
    const message = err instanceof Error ? err.message : String(err);
    setAppUpdateStatus(`Update check failed: ${message}`);
    toastError(message);
  }
}

function updateOpacityValue(): void {
  const value = Math.round((Number(dom.settingsOpacity.value) || 1) * 100);
  dom.settingsOpacityValue.textContent = `${value}%`;
}

function applyClickThroughSetting(): void {
  api.setClickThrough(getMode() === "overlay" && !!store.settings.overlayClickThrough);
  applyModeToDom(getMode());
}

export function loadSettingsIntoForm(): void {
  dom.settingsCompactOverlay.checked = !!store.settings.compactOverlay;
  dom.settingsOpacity.value = String(store.settings.overlayOpacity ?? 1);
  updateOpacityValue();
  dom.settingsOverlayClickThrough.checked = !!store.settings.overlayClickThrough;
  dom.settingsCheckAppUpdatesOnLaunch.checked = !!store.settings.checkAppUpdatesOnLaunch;
  dom.settingsAppUpdateCheckIntervalHours.value = String(
    store.settings.appUpdateCheckIntervalHours || 24
  );
  dom.settingsPageSize.value = String(store.settings.pageSize || 25);
  dom.settingsDefaultRace.value = store.settings.defaultRace || "Protoss";
}

export function bindSettingsTabEvents(): void {
  dom.saveSettingsButton.addEventListener("click", async () => {
    try {
      const update: Partial<Settings> = {
        compactOverlay: dom.settingsCompactOverlay.checked,
        overlayOpacity: Number(dom.settingsOpacity.value) || 1,
        overlayClickThrough: dom.settingsOverlayClickThrough.checked,
        checkAppUpdatesOnLaunch: dom.settingsCheckAppUpdatesOnLaunch.checked,
        appUpdateCheckIntervalHours: Math.max(
          1,
          Math.min(168, Number(dom.settingsAppUpdateCheckIntervalHours.value) || 24)
        ),
        pageSize: Math.max(6, Math.min(60, Number(dom.settingsPageSize.value) || 25)),
        defaultRace: (dom.settingsDefaultRace.value as Race) || "Protoss"
      };
      const next = await api.saveSettings(update);
      store.settings = next;
      api.setOpacity(store.settings.overlayOpacity);
      applyClickThroughSetting();
      renderOverlay();
      toastOk("Settings saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err));
    }
  });

  dom.settingsOpacity.addEventListener("input", () => {
    api.setOpacity(Number(dom.settingsOpacity.value) || 1);
    updateOpacityValue();
  });

  const bindSnap = (button: HTMLButtonElement, preset: WindowSnapPreset): void => {
    button.addEventListener("click", async () => {
      try {
        store.settings = await api.snapWindow(preset);
        toastOk("Window snapped.");
      } catch (err) {
        toastError(err instanceof Error ? err.message : String(err));
      }
    });
  };
  bindSnap(dom.settingsSnapTopLeft, "top-left");
  bindSnap(dom.settingsSnapTopRight, "top-right");
  bindSnap(dom.settingsSnapBottomLeft, "bottom-left");
  bindSnap(dom.settingsSnapBottomRight, "bottom-right");
  bindSnap(dom.settingsSnapCenter, "center");

  dom.checkAppUpdateButton.addEventListener("click", () => {
    void checkAppUpdateNow();
  });
  dom.installAppUpdateButton.addEventListener("click", async () => {
    if (!pendingAppUpdate) {
      await checkAppUpdateNow();
      if (!pendingAppUpdate) return;
    }
    const ok = window.confirm(
      `Install update ${pendingAppUpdate.version} now? The app may close and relaunch.`
    );
    if (!ok) return;
    try {
      const installed = await api.installAppUpdate();
      if (!installed) {
        setAppUpdateStatus("No installable update found.");
        toastOk("Already up to date.");
        return;
      }
      setAppUpdateStatus("Update installed. Restarting...");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAppUpdateStatus(`Update install failed: ${message}`);
      toastError(`Install failed: ${message}`);
    }
  });
}
