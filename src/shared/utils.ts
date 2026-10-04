/**
 * src/shared/utils.ts
 * Pure helpers consumed by both the main process and the renderer: race /
 * opponent constants, matchup derivation (PvT etc.), id slugging, "X - Y"
 * build-step parsing, fuzzy substring search, relative-time formatting,
 * and clamp. Has no DOM and no Node dependencies, so it's safe in either
 * runtime and trivially unit-testable.
 */
import type { Matchup, Opponent, Race } from "./types.js";

export const RACE_INITIAL: Record<Race | "Random", string> = {
  Terran: "T",
  Protoss: "P",
  Zerg: "Z",
  Random: "R"
};

export const RACE_LABEL: Record<Race | "Random", string> = {
  Terran: "테란",
  Protoss: "프로토스",
  Zerg: "저그",
  Random: "랜덤"
};

export const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: "초급",
  intermediate: "중급",
  advanced: "고급"
};

export function raceLabel(race: string): string {
  return (RACE_LABEL as Record<string, string>)[race] ?? race;
}

export function difficultyLabel(difficulty: string): string {
  return DIFFICULTY_LABEL[difficulty] ?? difficulty;
}

export const ALL_RACES: readonly Race[] = ["Terran", "Protoss", "Zerg"];
export const ALL_OPPONENTS: readonly Opponent[] = ["Terran", "Zerg", "Protoss", "Random"];

export function deriveMatchup(race: string, opponent: string): Matchup {
  const r = (RACE_INITIAL as Record<string, string>)[race] ?? "?";
  const o = (RACE_INITIAL as Record<string, string>)[opponent] ?? "?";
  return `${r}v${o}` as Matchup;
}

export function slugify(value: string): string {
  return (
    String(value || "build")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "build"
  );
}

export function uniqueId(base: string, takenIds: string[]): string {
  const taken = new Set(takenIds);
  const root = slugify(base);
  let candidate = root;
  let i = 2;
  while (taken.has(candidate)) {
    candidate = `${root}-${i++}`;
  }
  return candidate;
}

export interface SplitStep {
  supply: string | null;
  action: string;
}

export function splitStep(step: string): SplitStep {
  const s = String(step || "").trim();
  const m = /^(\d{1,3}(?:\s*\/\s*\d{1,3})?)\s*[-\u2013\u2014:.)]\s*(.+)$/.exec(s);
  if (m) {
    const supply = m[1] ?? "";
    const action = m[2] ?? "";
    return { supply: supply.replace(/\s+/g, ""), action: action.trim() };
  }
  return { supply: null, action: s };
}

export function matchesQuery(haystack: string, query: string): boolean {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const text = String(haystack || "").toLowerCase();
  return q.split(/\s+/).every((token) => text.includes(token));
}

export function formatRelative(timestamp: string | null | undefined): string {
  if (!timestamp) return "없음";
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return "알 수 없음";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}일 전`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
