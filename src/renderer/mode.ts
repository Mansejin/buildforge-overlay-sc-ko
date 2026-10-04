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
  const clickThroughActive = mode === "overlay" && store.settings.overlayClickThrough;
  dom.body.dataset.clickThrough = String(clickThroughActive);
  dom.overlayStatus.textContent =
    mode === "overlay"
      ? clickThroughActive
        ? "오버레이 - 마우스 클릭 통과"
        : "오버레이 - 조작 가능"
      : "관리자";
  dom.overlayDragHint.textContent = clickThroughActive
    ? "클릭 통과 켜짐 - Ctrl+Alt+L로 조작, Ctrl+Alt+K로 위치 이동"
    : "여기를 드래그해서 이동 - 창 가장자리로 크기 조절";
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
