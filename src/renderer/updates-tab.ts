/**
 * src/renderer/updates-tab.ts
 * Manager > Updates tab: triggers a Liquipedia revision check, renders
 * one row per imported build (with reason + last-modified), and refreshes
 * selected / all outdated builds via the main process.
 */
import { api } from "./api.js";
import { dom } from "./dom.js";
import { store } from "./state.js";
import { renderManagerList, setTab } from "./manager.js";
import { renderOverlay } from "./overlay.js";
import { setMode } from "./mode.js";
import { toast, toastError, toastOk } from "./toast.js";
import { formatRelative } from "../shared/utils.js";
import type { UpdateInfo } from "../shared/types.js";

function buildRow(update: UpdateInfo): HTMLElement {
  const row = document.createElement("div");
  row.className = `update-row ${update.outdated ? "outdated" : ""}`;
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = update.outdated && !update.customEdited;
  cb.dataset.buildId = update.buildId;
  row.appendChild(cb);
  const meta = document.createElement("div");
  const name = document.createElement("div");
  name.className = "item-name";
  name.textContent = update.name;
  const sub = document.createElement("div");
  sub.className = "item-meta";
  const reason =
    update.reason === "newer-revision"
      ? "Newer revision available"
      : update.reason === "no-stored-rev"
        ? "Imported before update tracking"
        : update.reason === "missing-on-server"
          ? "Page missing on Liquipedia"
          : "Up to date";
  sub.textContent = `${update.matchup} \u00b7 ${reason}${update.latestTimestamp ? ` \u00b7 latest ${formatRelative(update.latestTimestamp)}` : ""}${update.customEdited ? " \u00b7 custom edited" : ""}`;
  meta.append(name, sub);
  row.appendChild(meta);
  const open = document.createElement("button");
  open.textContent = "Open";
  open.className = "small-button";
  open.addEventListener("click", () => {
    if (update.sourceUrl) api.openExternal(update.sourceUrl);
  });
  row.appendChild(open);
  const refresh = document.createElement("button");
  refresh.textContent = "Refresh";
  refresh.className = "small-button";
  refresh.addEventListener("click", () => refreshSingle(update.buildId));
  row.appendChild(refresh);
  return row;
}

export function renderUpdatesList(): void {
  const all = store.pendingUpdates.all || [];
  dom.updatesList.innerHTML = "";
  if (!all.length) {
    dom.updatesSummary.textContent = "No imported builds yet, or no check has been run.";
    return;
  }
  const outdated = all.filter((u) => u.outdated);
  const unknown = all.filter((u) => u.reason === "no-stored-rev");
  const lastCheckedSuffix = store.pendingUpdates.lastChecked
    ? ` Last checked ${formatRelative(store.pendingUpdates.lastChecked)}.`
    : "";
  if (outdated.length === 0 && unknown.length === 0) {
    dom.updatesSummary.textContent = `Catalog up to date - ${all.length} builds tracked.${lastCheckedSuffix}`;
  } else {
    const parts: string[] = [];
    if (outdated.length > 0) {
      parts.push(`${outdated.length} of ${all.length} builds have updates available`);
    }
    if (unknown.length > 0) {
      parts.push(
        `${unknown.length} imported before revision tracking - refresh once to enable diffing`
      );
    }
    dom.updatesSummary.textContent = `${parts.join(". ")}.${lastCheckedSuffix}`;
  }
  const sorted = [...all].sort((a, b) => {
    if (a.outdated !== b.outdated) return Number(b.outdated) - Number(a.outdated);
    const aUnknown = a.reason === "no-stored-rev" ? 1 : 0;
    const bUnknown = b.reason === "no-stored-rev" ? 1 : 0;
    return bUnknown - aUnknown;
  });
  for (const u of sorted) dom.updatesList.appendChild(buildRow(u));
  // Badge ONLY counts truly outdated builds (newer revision on Liquipedia).
  // no-stored-rev is informational and surfaces in the summary text only.
  dom.updatesBadgeButton.hidden = outdated.length === 0;
  dom.updatesBadgeButton.title = outdated.length
    ? `${outdated.length} update(s) available - click to open Manager`
    : "";
}

async function refreshSingle(buildId: string): Promise<void> {
  try {
    await api.refreshBuild(buildId);
    toastOk("Refreshed.");
    await reloadAndRecheck();
  } catch (err) {
    toastError(err instanceof Error ? err.message : String(err));
  }
}

async function reloadAndRecheck(): Promise<void> {
  store.data = await api.getBuilds();
  if (store.pendingUpdates.all) {
    store.pendingUpdates.all = store.pendingUpdates.all.map((u) => {
      const b = store.data.builds.find((x) => x.id === u.buildId);
      if (!b) return u;
      const outdated =
        u.latestRevId != null && b.revisionId != null && u.latestRevId !== b.revisionId;
      const reason: typeof u.reason =
        b.revisionId == null && u.latestRevId != null
          ? "no-stored-rev"
          : outdated
            ? "newer-revision"
            : "up-to-date";
      return { ...u, currentRevId: b.revisionId, outdated, reason };
    });
    store.pendingUpdates.outdated = store.pendingUpdates.all.filter((u) => u.outdated);
    store.pendingUpdates.unknown = store.pendingUpdates.all.filter(
      (u) => u.reason === "no-stored-rev"
    );
  }
  renderUpdatesList();
  renderManagerList();
  renderOverlay();
}

export function bindUpdatesTabEvents(): void {
  dom.checkUpdatesButton.addEventListener("click", async () => {
    try {
      dom.checkUpdatesButton.disabled = true;
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
      renderManagerList();
      renderOverlay();
      const n = result.outdated.length;
      if (n === 0) toastOk("All Liquipedia builds are up to date.");
      else toast(`${n} build(s) have updates available.`, "warn");
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err));
    } finally {
      dom.checkUpdatesButton.disabled = false;
    }
  });

  dom.refreshSelectedUpdatesButton.addEventListener("click", async () => {
    const ids = Array.from(
      dom.updatesList.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")
    )
      .map((cb) => cb.dataset.buildId)
      .filter((id): id is string => typeof id === "string");
    if (!ids.length) {
      toastError("Select at least one build to refresh.");
      return;
    }
    try {
      dom.refreshSelectedUpdatesButton.disabled = true;
      const result = await api.refreshBuilds(ids, { force: false });
      toastOk(
        `Refreshed ${result.refreshed.length}, skipped ${result.skippedCustom.length} custom, failed ${result.failed.length}.`
      );
      await reloadAndRecheck();
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err));
    } finally {
      dom.refreshSelectedUpdatesButton.disabled = false;
    }
  });

  dom.refreshAllUpdatesButton.addEventListener("click", async () => {
    const outdated = store.pendingUpdates.outdated || [];
    if (!outdated.length) {
      toastError("Nothing to refresh - run Check first.");
      return;
    }
    if (!confirm(`Refresh ${outdated.length} outdated build(s) from Liquipedia?`)) return;
    try {
      dom.refreshAllUpdatesButton.disabled = true;
      const ids = outdated.map((u) => u.buildId);
      const result = await api.refreshBuilds(ids, { force: false });
      toastOk(
        `Refreshed ${result.refreshed.length}, skipped ${result.skippedCustom.length} custom, failed ${result.failed.length}.`
      );
      await reloadAndRecheck();
    } catch (err) {
      toastError(err instanceof Error ? err.message : String(err));
    } finally {
      dom.refreshAllUpdatesButton.disabled = false;
    }
  });

  dom.updatesBadgeButton.addEventListener("click", () => {
    void setMode("manager");
    setTab("updates");
  });
}
