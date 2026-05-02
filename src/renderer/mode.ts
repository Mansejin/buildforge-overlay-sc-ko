/**
 * src/renderer/mode.ts
 * Owns the v2.0 Manager <-> Overlay view-mode toggle. Flipping the body's
 * data-mode attribute is enough to swap CSS visibility; this module also
 * pings the Tauri side via window_set_mode so the OS-level chrome
 * (decorations, always-on-top, frame size) tracks the renderer's view.
 *
 * The Rust side persists settings.lastView so the next launch boots into
 * the same mode the user left it in.
 */
import { dom } from "./dom.js";
import { store } from "./state.js";
import { renderOverlay } from "./overlay.js";
import { renderManagerList } from "./manager.js";
import { renderUpdatesList } from "./updates-tab.js";
import { invoke } from "@tauri-apps/api/core";
import type { Settings, ViewMode } from "../shared/types.js";

let currentMode: ViewMode = "manager";
let pendingMode: Promise<void> | null = null;

export function getMode(): ViewMode {
  return currentMode;
}

export function applyModeToDom(mode: ViewMode): void {
  currentMode = mode;
  dom.body.dataset.mode = mode;
  dom.modeManagerButton.classList.toggle("active", mode === "manager");
  dom.modeOverlayButton.classList.toggle("active", mode === "overlay");
  dom.modeManagerButton.setAttribute("aria-selected", String(mode === "manager"));
  dom.modeOverlayButton.setAttribute("aria-selected", String(mode === "overlay"));
  dom.overlayStatus.textContent = mode === "overlay" ? "Always on top" : "Manager";
}

/**
 * Switch to the requested view. Updates the DOM immediately for
 * snappiness, then asks the Tauri side to flip the OS-level window
 * chrome and persist `lastView`. Coalesces concurrent requests so
 * mashing the toggle never queues up multiple IPCs in flight.
 */
export async function setMode(mode: ViewMode): Promise<void> {
  if (mode === currentMode && !pendingMode) return;
  applyModeToDom(mode);
  if (mode === "manager") {
    renderManagerList();
    renderUpdatesList();
  } else {
    renderOverlay();
  }
  if (pendingMode) {
    try {
      await pendingMode;
    } catch {
      // best-effort; the new request below supersedes
    }
  }
  pendingMode = (async () => {
    try {
      const settings = await invoke<Settings>("window_set_mode", { mode });
      store.settings = settings;
    } catch (err) {
      console.warn("window_set_mode failed:", err);
    } finally {
      pendingMode = null;
    }
  })();
  await pendingMode;
}

export async function toggleMode(): Promise<void> {
  await setMode(currentMode === "manager" ? "overlay" : "manager");
}

export function bindModeToggle(): void {
  dom.modeManagerButton.addEventListener("click", () => {
    void setMode("manager");
  });
  dom.modeOverlayButton.addEventListener("click", () => {
    void setMode("overlay");
  });
}
