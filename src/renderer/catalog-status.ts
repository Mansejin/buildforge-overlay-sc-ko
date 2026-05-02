/**
 * src/renderer/catalog-status.ts
 * Renders the "Catalog last updated <date>" banner that appears at the
 * top of the Manager view when the bundled data/builds.json is older
 * than the user's scan interval. Clicking the Re-sync button kicks
 * off a check-for-updates run; the banner re-evaluates after.
 */
import { dom } from "./dom.js";
import { api } from "./api.js";
import { store } from "./state.js";
import { renderUpdatesList } from "./updates-tab.js";
import { renderOverlay } from "./overlay.js";
import { toast, toastError } from "./toast.js";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function ageInHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

export function refreshCatalogStatusBanner(): void {
  const lastUpdated = store.data.lastUpdated;
  const lastChecked = store.pendingUpdates.lastChecked;
  // The banner only shows in Manager mode (CSS hides it in Overlay mode).
  // Trigger logic: never-checked OR catalog metadata is older than 30 days.
  const catalogAgeHours = ageInHours(lastUpdated);
  const checkAgeHours = ageInHours(lastChecked);
  const stale =
    !lastChecked ||
    (catalogAgeHours != null && catalogAgeHours > 24 * 30) ||
    (checkAgeHours != null && checkAgeHours > store.settings.scanIntervalHours);
  if (!stale) {
    dom.catalogStatusBanner.hidden = true;
    return;
  }
  dom.catalogStatusBanner.hidden = false;
  const lastCheckedSuffix = lastChecked
    ? ` (last update check ${formatDate(lastChecked)})`
    : " - no check has been run yet";
  dom.catalogStatusText.textContent = `Catalog snapshot from ${formatDate(lastUpdated)}${lastCheckedSuffix}.`;
}

export function bindCatalogStatusEvents(): void {
  dom.catalogResyncButton.addEventListener("click", async () => {
    try {
      dom.catalogResyncButton.disabled = true;
      const result = await api.checkForUpdates();
      store.pendingUpdates.all = result.all;
      store.pendingUpdates.outdated = result.outdated;
      store.pendingUpdates.unknown = result.unknown ?? [];
      const now = new Date().toISOString();
      store.pendingUpdates.lastChecked = now;
      try {
        store.settings = await api.saveSettings({
          ...store.settings,
          lastUpdateCheckAt: now
        });
      } catch (saveErr) {
        console.warn("Could not persist lastUpdateCheckAt:", saveErr);
      }
      renderUpdatesList();
      renderOverlay();
      refreshCatalogStatusBanner();
      if (result.outdated.length === 0) {
        toast("Catalog is up to date.", "ok");
      } else {
        toast(
          `${result.outdated.length} build(s) have updates - see the Updates tab.`,
          "warn",
          5000
        );
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err));
    } finally {
      dom.catalogResyncButton.disabled = false;
    }
  });
}
