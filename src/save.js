const KEY = 'towerinc.save.v1';

export function defaultSave() {
  return { cores: 0, tree: { core: 1 }, bestWave: 0, runs: 0, totalKills: 0, totalCores: 0 };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { ...defaultSave(), ...d, tree: { core: 1, ...(d.tree || {}) } };
    }
  } catch (e) { /* storage unavailable or corrupt: start fresh */ }
  return defaultSave();
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

// Downloads the save as a dated .txt file containing the save JSON.
export function exportSave(save) {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tower-inc-save-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Parses an exported save file; throws if it doesn't look like a Tower Inc. save.
export function parseSave(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || typeof d.cores !== 'number' || !d.tree || typeof d.tree !== 'object') {
    throw new Error('Not a Tower Inc. save file');
  }
  return { ...defaultSave(), ...d, tree: { core: 1, ...d.tree } };
}

export function wipeSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
