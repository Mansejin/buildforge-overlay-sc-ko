/**
 * src/renderer/dom.ts
 * Single source of truth for DOM element references. Looks up every id
 * declared in index.html once at module load and exposes them on the
 * `dom` object so the rest of the renderer doesn't repeat
 * `document.getElementById` calls. byId<T> throws on a missing id so
 * callers get a useful stack instead of a silent null-deref later.
 */

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

function queryAll<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return Array.from(document.querySelectorAll(selector)) as T[];
}

export interface Dom {
  body: HTMLElement;
  overlayStatus: HTMLElement;
  manageButton: HTMLButtonElement;
  favoriteButton: HTMLButtonElement;
  compactButton: HTMLButtonElement;
  raceTabs: HTMLElement[];
  oppChips: HTMLElement[];
  buildSearch: HTMLInputElement;
  buildSelect: HTMLSelectElement;
  prevBuildButton: HTMLButtonElement;
  nextBuildButton: HTMLButtonElement;
  buildCard: HTMLElement;
  buildName: HTMLElement;
  matchupChip: HTMLElement;
  difficultyChip: HTMLElement;
  favoritedChip: HTMLElement;
  buildTags: HTMLElement;
  sourceButton: HTMLButtonElement;
  buildNotes: HTMLElement;
  buildUserNotes: HTMLElement;
  steps: HTMLElement;
  countersBlock: HTMLElement;
  countersList: HTMLElement;
  counteredByList: HTMLElement;
  prevPageButton: HTMLButtonElement;
  pageIndicator: HTMLElement;
  nextPageButton: HTMLButtonElement;
  toasts: HTMLElement;
  modeManagerButton: HTMLButtonElement;
  modeOverlayButton: HTMLButtonElement;
  catalogStatusBanner: HTMLElement;
  catalogStatusText: HTMLElement;
  settingsCatalogDate: HTMLElement;
  managerDialog: HTMLDialogElement;
  managerCloseButton: HTMLButtonElement;
  managerRaceFilter: HTMLSelectElement;
  managerMatchupFilter: HTMLSelectElement;
  managerSearch: HTMLInputElement;
  managerBuildList: HTMLElement;
  managerEmptyState: HTMLElement;
  newBuildButton: HTMLButtonElement;
  duplicateBuildButton: HTMLButtonElement;
  deleteBuildButton: HTMLButtonElement;
  backupButton: HTMLButtonElement;
  openDataFolderButton: HTMLButtonElement;
  editTabButton: HTMLButtonElement;
  settingsTabButton: HTMLButtonElement;
  editTab: HTMLElement;
  settingsTab: HTMLElement;
  formId: HTMLInputElement;
  formName: HTMLInputElement;
  formRace: HTMLSelectElement;
  formOpponent: HTMLSelectElement;
  formDifficulty: HTMLSelectElement;
  formTags: HTMLInputElement;
  formSourceName: HTMLInputElement;
  formSourceUrl: HTMLInputElement;
  formNotes: HTMLTextAreaElement;
  formUserNotes: HTMLTextAreaElement;
  formSteps: HTMLTextAreaElement;
  formCustomEdited: HTMLInputElement;
  formFavorite: HTMLInputElement;
  saveBuildButton: HTMLButtonElement;
  useBuildButton: HTMLButtonElement;
  openSourceFromFormButton: HTMLButtonElement;
  settingsCompactOverlay: HTMLInputElement;
  settingsOpacity: HTMLInputElement;
  settingsOpacityValue: HTMLElement;
  settingsOverlayClickThrough: HTMLInputElement;
  settingsSnapTopLeft: HTMLButtonElement;
  settingsSnapTopRight: HTMLButtonElement;
  settingsSnapBottomLeft: HTMLButtonElement;
  settingsSnapBottomRight: HTMLButtonElement;
  settingsSnapCenter: HTMLButtonElement;
  settingsCheckAppUpdatesOnLaunch: HTMLInputElement;
  settingsAppUpdateCheckIntervalHours: HTMLInputElement;
  checkAppUpdateButton: HTMLButtonElement;
  installAppUpdateButton: HTMLButtonElement;
  appUpdateStatus: HTMLElement;
  settingsPageSize: HTMLInputElement;
  settingsDefaultRace: HTMLSelectElement;
  saveSettingsButton: HTMLButtonElement;
  overlayDragStrip: HTMLElement;
  overlayDragHint: HTMLElement;
}

export const dom: Dom = {
  body: document.body,
  overlayStatus: byId("overlayStatus"),
  manageButton: byId<HTMLButtonElement>("manageButton"),
  favoriteButton: byId<HTMLButtonElement>("favoriteButton"),
  compactButton: byId<HTMLButtonElement>("compactButton"),
  raceTabs: queryAll(".race-tab"),
  oppChips: queryAll(".opp-chip"),
  buildSearch: byId<HTMLInputElement>("buildSearch"),
  buildSelect: byId<HTMLSelectElement>("buildSelect"),
  prevBuildButton: byId<HTMLButtonElement>("prevBuildButton"),
  nextBuildButton: byId<HTMLButtonElement>("nextBuildButton"),
  buildCard: byId("buildCard"),
  buildName: byId("buildName"),
  matchupChip: byId("matchupChip"),
  difficultyChip: byId("difficultyChip"),
  favoritedChip: byId("favoritedChip"),
  buildTags: byId("buildTags"),
  sourceButton: byId<HTMLButtonElement>("sourceButton"),
  buildNotes: byId("buildNotes"),
  buildUserNotes: byId("buildUserNotes"),
  steps: byId("steps"),
  countersBlock: byId("countersBlock"),
  countersList: byId("countersList"),
  counteredByList: byId("counteredByList"),
  prevPageButton: byId<HTMLButtonElement>("prevPageButton"),
  pageIndicator: byId("pageIndicator"),
  nextPageButton: byId<HTMLButtonElement>("nextPageButton"),
  toasts: byId("toasts"),
  modeManagerButton: byId<HTMLButtonElement>("modeManagerButton"),
  modeOverlayButton: byId<HTMLButtonElement>("modeOverlayButton"),
  catalogStatusBanner: byId("catalogStatusBanner"),
  catalogStatusText: byId("catalogStatusText"),
  settingsCatalogDate: byId("settingsCatalogDate"),
  managerDialog: byId<HTMLDialogElement>("managerDialog"),
  managerCloseButton: byId<HTMLButtonElement>("managerCloseButton"),
  managerRaceFilter: byId<HTMLSelectElement>("managerRaceFilter"),
  managerMatchupFilter: byId<HTMLSelectElement>("managerMatchupFilter"),
  managerSearch: byId<HTMLInputElement>("managerSearch"),
  managerBuildList: byId("managerBuildList"),
  managerEmptyState: byId("managerEmptyState"),
  newBuildButton: byId<HTMLButtonElement>("newBuildButton"),
  duplicateBuildButton: byId<HTMLButtonElement>("duplicateBuildButton"),
  deleteBuildButton: byId<HTMLButtonElement>("deleteBuildButton"),
  backupButton: byId<HTMLButtonElement>("backupButton"),
  openDataFolderButton: byId<HTMLButtonElement>("openDataFolderButton"),
  editTabButton: byId<HTMLButtonElement>("editTabButton"),
  settingsTabButton: byId<HTMLButtonElement>("settingsTabButton"),
  editTab: byId("editTab"),
  settingsTab: byId("settingsTab"),
  formId: byId<HTMLInputElement>("formId"),
  formName: byId<HTMLInputElement>("formName"),
  formRace: byId<HTMLSelectElement>("formRace"),
  formOpponent: byId<HTMLSelectElement>("formOpponent"),
  formDifficulty: byId<HTMLSelectElement>("formDifficulty"),
  formTags: byId<HTMLInputElement>("formTags"),
  formSourceName: byId<HTMLInputElement>("formSourceName"),
  formSourceUrl: byId<HTMLInputElement>("formSourceUrl"),
  formNotes: byId<HTMLTextAreaElement>("formNotes"),
  formUserNotes: byId<HTMLTextAreaElement>("formUserNotes"),
  formSteps: byId<HTMLTextAreaElement>("formSteps"),
  formCustomEdited: byId<HTMLInputElement>("formCustomEdited"),
  formFavorite: byId<HTMLInputElement>("formFavorite"),
  saveBuildButton: byId<HTMLButtonElement>("saveBuildButton"),
  useBuildButton: byId<HTMLButtonElement>("useBuildButton"),
  openSourceFromFormButton: byId<HTMLButtonElement>("openSourceFromFormButton"),
  settingsCompactOverlay: byId<HTMLInputElement>("settingsCompactOverlay"),
  settingsOpacity: byId<HTMLInputElement>("settingsOpacity"),
  settingsOpacityValue: byId("settingsOpacityValue"),
  settingsOverlayClickThrough: byId<HTMLInputElement>("settingsOverlayClickThrough"),
  settingsSnapTopLeft: byId<HTMLButtonElement>("settingsSnapTopLeft"),
  settingsSnapTopRight: byId<HTMLButtonElement>("settingsSnapTopRight"),
  settingsSnapBottomLeft: byId<HTMLButtonElement>("settingsSnapBottomLeft"),
  settingsSnapBottomRight: byId<HTMLButtonElement>("settingsSnapBottomRight"),
  settingsSnapCenter: byId<HTMLButtonElement>("settingsSnapCenter"),
  settingsCheckAppUpdatesOnLaunch: byId<HTMLInputElement>("settingsCheckAppUpdatesOnLaunch"),
  settingsAppUpdateCheckIntervalHours: byId<HTMLInputElement>(
    "settingsAppUpdateCheckIntervalHours"
  ),
  checkAppUpdateButton: byId<HTMLButtonElement>("checkAppUpdateButton"),
  installAppUpdateButton: byId<HTMLButtonElement>("installAppUpdateButton"),
  appUpdateStatus: byId("appUpdateStatus"),
  settingsPageSize: byId<HTMLInputElement>("settingsPageSize"),
  settingsDefaultRace: byId<HTMLSelectElement>("settingsDefaultRace"),
  saveSettingsButton: byId<HTMLButtonElement>("saveSettingsButton"),
  overlayDragStrip: byId("overlayDragStrip"),
  overlayDragHint: byId("overlayDragHint")
};
