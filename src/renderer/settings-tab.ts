/**
 * src/renderer/settings-tab.ts
 * Manager > Settings tab: load/save overlay behavior, opacity, page size,
 * and default race. Persisted via the main-process settings.json.
 */
import { api } from "./api.js";
import { dom } from "./dom.js";
import { store } from "./state.js";
import { toastError, toastOk } from "./toast.js";
import { renderOverlay } from "./overlay.js";
import { applyModeToDom, getMode } from "./mode.js";
import type { Race, Settings } from "../shared/types.js";

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
}
