// Persistent meta-progression (DNA, lab upgrades, records) in localStorage.
// Every access is wrapped in try/catch: storage can be unavailable (private mode, blocked cookies).

const KEY = "outbreak-forge-save-v1";

export const DEFAULT_SAVE = {
  dna: 0,
  lab: {}, // labUpgradeId -> level
  best: { wave: 0, kills: 0, time: 0 },
  runs: 0,
  totalKills: 0,
  muted: false,
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const data = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SAVE), ...data, best: { ...DEFAULT_SAVE.best, ...(data.best || {}) } };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable: progress lives only for this session */
  }
}

export function resetSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULT_SAVE);
}
