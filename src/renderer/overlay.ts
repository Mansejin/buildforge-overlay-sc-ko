/**
 * src/renderer/overlay.ts
 * Renders the always-on-top overlay window: race tabs, opponent chips,
 * build picker, build header (matchup / difficulty / favorite / update
 * chips), paginated steps, counters, and footer paging. Exposes
 * `renderOverlay()` and the click/keyboard event bindings.
 */
import { dom } from "./dom.js";
import {
  buildsForCurrentMatchup,
  currentBuild,
  nextPage,
  pageRange,
  prevPage,
  setBuildId,
  setOpponent,
  setRace,
  setSearch,
  store,
  toggleFavoriteOnCurrent,
  totalPages
} from "./state.js";
import {
  deriveMatchup,
  difficultyLabel,
  matchesQuery,
  raceLabel,
  splitStep
} from "../shared/utils.js";
import type { Build, Opponent, Race } from "../shared/types.js";

const onChangeHandlers: Array<() => void> = [];

export function onOverlayChange(fn: () => void): void {
  onChangeHandlers.push(fn);
}

function emitChange(): void {
  for (const fn of onChangeHandlers) {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  }
}

function buildsForCurrentMatchupFiltered(): Build[] {
  const all = buildsForCurrentMatchup();
  const q = store.state.search;
  const filtered = all.filter((b) =>
    matchesQuery(`${b.name} ${b.tags?.join(" ") || ""} ${b.difficulty || ""}`, q)
  );
  return filtered.sort((a, b) => {
    if ((a.favorite ? 1 : 0) !== (b.favorite ? 1 : 0)) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function populateOpponentChips(): void {
  const races = new Set(
    store.data.builds.filter((b) => b.race === store.state.race).map((b) => b.opponent)
  );
  for (const chip of dom.oppChips) {
    const opp = chip.dataset.opp as Opponent | undefined;
    if (!opp) continue;
    chip.classList.toggle("active", opp === store.state.opponent);
    chip.classList.toggle("disabled", !races.has(opp));
    chip.title = races.has(opp)
      ? `vs ${raceLabel(opp)}`
      : `${raceLabel(store.state.race)} vs ${raceLabel(opp)} 빌드가 아직 없습니다`;
  }
}

function populateRaceTabs(): void {
  for (const tab of dom.raceTabs) {
    tab.classList.toggle("active", tab.dataset.race === store.state.race);
  }
}

/**
 * Builds for a single matchup are now usually variant clusters - e.g.
 * Forge FE has 4 variants (9 Pool / 12 Pool / 12 Hatch / Overpool) all
 * pointing back to a parent build via `variantOf`. Group them under
 * <optgroup> so the in-game picker matches Liquipedia's mental model:
 * pick the strategy first, then the variant for the scout you saw.
 */
function populateBuildSelect(): void {
  const builds = buildsForCurrentMatchupFiltered();
  dom.buildSelect.innerHTML = "";
  const buildById = new Map(builds.map((b) => [b.id, b]));
  const groups = new Map<string, Build[]>();
  const standalone: Build[] = [];
  for (const b of builds) {
    const parentId = b.variantOf || (buildHasChildren(b.id, builds) ? b.id : null);
    if (!parentId) {
      standalone.push(b);
      continue;
    }
    const list = groups.get(parentId) || [];
    list.push(b);
    groups.set(parentId, list);
  }
  // Render standalone builds first, then each variant cluster as an
  // <optgroup>. Within a cluster the parent (variantOf == null) sorts
  // first, then variants alphabetically by display name.
  for (const b of standalone) dom.buildSelect.appendChild(renderBuildOption(b));
  const sortedGroupIds = [...groups.keys()].sort((a, b) => {
    const an = buildById.get(a)?.name || "";
    const bn = buildById.get(b)?.name || "";
    return an.localeCompare(bn);
  });
  for (const parentId of sortedGroupIds) {
    const cluster = (groups.get(parentId) || []).slice().sort((a, b) => {
      const aIsParent = a.id === parentId ? 0 : 1;
      const bIsParent = b.id === parentId ? 0 : 1;
      if (aIsParent !== bIsParent) return aIsParent - bIsParent;
      return a.name.localeCompare(b.name);
    });
    const groupName = displayGroupName(parentId, cluster, buildById);
    const og = document.createElement("optgroup");
    og.label = groupName;
    for (const b of cluster) {
      const option = renderBuildOption(b, { trimPrefix: groupName });
      og.appendChild(option);
    }
    dom.buildSelect.appendChild(og);
  }
  if (!builds.some((b) => b.id === store.state.buildId)) {
    if (builds.length && builds[0]) setBuildId(builds[0].id);
  }
  dom.buildSelect.value = store.state.buildId || "";
}

function buildHasChildren(id: string, builds: Build[]): boolean {
  return builds.some((b) => b.variantOf === id);
}

function displayGroupName(parentId: string, cluster: Build[], byId: Map<string, Build>): string {
  const parent = byId.get(parentId);
  if (parent) return parent.name.replace(/\s*-\s*[^-]+$/, "").trim() || parent.name;
  // Parent missing from the filtered set (e.g. filtered out by search) -
  // synthesize a name from the longest common prefix of the variants.
  const names = cluster.map((b) => b.name);
  let prefix = names[0] || "";
  for (const n of names.slice(1)) {
    while (n.indexOf(prefix) !== 0 && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix.replace(/\s*-\s*$/, "").trim() || "변형 빌드";
}

function renderBuildOption(b: Build, opts?: { trimPrefix?: string }): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = b.id;
  const star = b.favorite ? "\u2605 " : "";
  let label = b.name;
  if (opts?.trimPrefix && label.startsWith(opts.trimPrefix)) {
    const tail = label.slice(opts.trimPrefix.length).replace(/^\s*[-:]\s*/, "");
    if (tail.length > 0) label = tail;
  }
  option.textContent = `${star}${label}`;
  return option;
}

function renderBuildHead(build: Build): void {
  dom.buildName.textContent = build.name;
  dom.matchupChip.textContent = build.matchup || deriveMatchup(build.race, build.opponent);
  dom.matchupChip.style.color = "var(--accent)";
  if (build.difficulty) {
    dom.difficultyChip.hidden = false;
    dom.difficultyChip.textContent = difficultyLabel(build.difficulty);
  } else dom.difficultyChip.hidden = true;
  dom.favoritedChip.hidden = !build.favorite;
  dom.buildTags.innerHTML = "";
  for (const tag of build.tags || []) {
    if (tag === "imported" || tag === "needs-review" || tag === "liquipedia") continue;
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    dom.buildTags.appendChild(chip);
  }
  if (build.notes) {
    dom.buildNotes.hidden = false;
    dom.buildNotes.textContent = build.notes;
  } else dom.buildNotes.hidden = true;
  if (build.userNotes) {
    dom.buildUserNotes.hidden = false;
    dom.buildUserNotes.textContent = build.userNotes;
  } else dom.buildUserNotes.hidden = true;
}

function renderSteps(): void {
  dom.steps.innerHTML = "";
  for (const { step, index } of pageRange()) {
    const li = document.createElement("li");
    const { supply, action } = splitStep(step);
    if (!supply) li.classList.add("no-supply");
    if (supply) {
      const supplyEl = document.createElement("span");
      supplyEl.className = "step-supply";
      supplyEl.textContent = supply;
      li.appendChild(supplyEl);
    }
    const actionEl = document.createElement("span");
    actionEl.className = "step-action";
    actionEl.textContent = action;
    li.appendChild(actionEl);
    li.dataset.stepIndex = String(index);
    dom.steps.appendChild(li);
  }
}

function renderCounters(build: Build): void {
  const has = (build.counters?.length || 0) + (build.counteredBy?.length || 0) > 0;
  dom.countersBlock.hidden = !has;
  dom.countersList.textContent = (build.counters || []).join(", ") || "-";
  dom.counteredByList.textContent = (build.counteredBy || []).join(", ") || "-";
}

function renderPageIndicator(): void {
  const total = totalPages();
  const cur = Math.min(store.state.page + 1, total);
  const compact = !!store.settings.compactOverlay;
  dom.pageIndicator.textContent = compact ? `${cur} / ${total}` : `${cur} / ${total} 페이지`;
  dom.prevPageButton.disabled = store.state.page <= 0;
  dom.nextPageButton.disabled = store.state.page >= total - 1;
  dom.prevPageButton.style.visibility = total > 1 ? "visible" : "hidden";
  dom.nextPageButton.style.visibility = total > 1 ? "visible" : "hidden";
}

export function renderOverlay(): void {
  document.body.classList.toggle("compact", !!store.settings.compactOverlay);
  document.body.dataset.race = store.state.race;
  populateRaceTabs();
  populateOpponentChips();
  populateBuildSelect();
  const build = currentBuild();
  if (!build) {
    dom.buildName.textContent = "이 종족전에는 빌드가 없습니다";
    dom.buildNotes.hidden = false;
    dom.buildNotes.textContent = "관리자 화면에서 '새 빌드 만들기'로 추가하세요.";
    dom.steps.innerHTML = "";
    dom.countersBlock.hidden = true;
    dom.matchupChip.textContent = deriveMatchup(store.state.race, store.state.opponent);
    dom.difficultyChip.hidden = true;
    dom.favoritedChip.hidden = true;
    dom.buildTags.innerHTML = "";
    dom.pageIndicator.textContent = store.settings.compactOverlay ? "0 / 0" : "0 / 0 페이지";
    return;
  }
  renderBuildHead(build);
  renderSteps();
  renderCounters(build);
  renderPageIndicator();
}

export interface OverlayDeps {
  openExternal: (url: string) => void;
  toggleCompact: () => void | Promise<void>;
  persistFavorite: (build: Build) => Promise<void> | void;
}

export function bindOverlayEvents({
  openExternal,
  toggleCompact,
  persistFavorite
}: OverlayDeps): void {
  for (const tab of dom.raceTabs) {
    tab.addEventListener("click", () => {
      const race = tab.dataset.race as Race | undefined;
      if (!race) return;
      setRace(race);
      renderOverlay();
      emitChange();
    });
  }
  for (const chip of dom.oppChips) {
    chip.addEventListener("click", () => {
      const opp = chip.dataset.opp as Opponent | undefined;
      if (!opp) return;
      setOpponent(opp);
      renderOverlay();
      emitChange();
    });
  }
  dom.buildSelect.addEventListener("change", () => {
    setBuildId(dom.buildSelect.value);
    renderOverlay();
    emitChange();
  });
  dom.buildSearch.addEventListener("input", (e) => {
    setSearch((e.target as HTMLInputElement).value);
    renderOverlay();
  });
  dom.prevBuildButton.addEventListener("click", () => {
    cycleBuild(-1);
    emitChange();
  });
  dom.nextBuildButton.addEventListener("click", () => {
    cycleBuild(1);
    emitChange();
  });
  dom.prevPageButton.addEventListener("click", () => {
    prevPage();
    renderOverlay();
  });
  dom.nextPageButton.addEventListener("click", () => {
    nextPage();
    renderOverlay();
  });
  dom.sourceButton.addEventListener("click", () => {
    const url = currentBuild()?.sourceUrl;
    if (url) openExternal(url);
  });
  dom.favoriteButton.addEventListener("click", async () => {
    const build = toggleFavoriteOnCurrent();
    if (build) {
      await persistFavorite(build);
      renderOverlay();
    }
  });
  dom.compactButton.addEventListener("click", () => {
    void toggleCompact();
  });
}

export function cycleBuild(direction: 1 | -1): void {
  const builds = buildsForCurrentMatchupFiltered();
  if (!builds.length) return;
  const idx = builds.findIndex((b) => b.id === store.state.buildId);
  const nextIdx = (idx + direction + builds.length) % builds.length;
  const nextBuild = builds[nextIdx];
  if (!nextBuild) return;
  setBuildId(nextBuild.id);
  renderOverlay();
}
