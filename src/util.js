const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

// Compact number formatting for an incremental game: 999, 1.23K, 45.6M, ...
export function fmt(n) {
  if (!isFinite(n)) return '∞';
  const neg = n < 0;
  let v = Math.abs(n);
  if (v < 1000) return (neg ? '-' : '') + (v < 10 && v % 1 !== 0 ? v.toFixed(1) : Math.floor(v).toString());
  let i = 0;
  while (v >= 1000 && i < SUFFIX.length - 1) { v /= 1000; i++; }
  return (neg ? '-' : '') + (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)) + SUFFIX[i];
}
