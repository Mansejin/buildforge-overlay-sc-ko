/**
 * src/renderer/catalog-status.ts
 * Displays the bundled catalog's release-time sync date. The packaged app
 * does not perform Liquipedia checks or imports; maintainers refresh
 * data/builds.json with scripts/scrape-liquipedia.mjs before release.
 */
import { dom } from "./dom.js";
import { store } from "./state.js";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function refreshCatalogStatusBanner(): void {
  const syncedAt = formatDate(store.data.lastUpdated);
  dom.catalogStatusBanner.hidden = false;
  dom.catalogStatusText.textContent = `Build catalog synced ${syncedAt}.`;
  dom.settingsCatalogDate.textContent = syncedAt;
}
