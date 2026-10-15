// Pure name normalization + near-match suggestion (master record:
// "suggest, never auto-merge"; the nasi goreng pair MUST be a suggest, not a merge).

/**
 * Unicode-safe normalization for food names:
 * trim → unicode-normalize (NFKC-friendly) → strip punctuation (keep ASCII word
 * letters, digits, CJK/kana/hangul blocks, spaces) → collapse spaces → lowercase.
 * Deliberately does NOT strip non-ASCII scripts (public: Indonesian +
 * international dishes).
 */
export function normName(raw: string): string {
  if (typeof raw !== 'string') throw new Error('name must be a string');
  return raw.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Jaro similarity (0..1), classic formulation. */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const matchDist = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatches = new Array<boolean>(la).fill(false);
  const bMatches = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(lb - 1, i + matchDist);
    for (let j = start; j <= end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / la + matches / lb + (matches - t) / matches) / 3;
}

/** Jaro-Winkler: Jaro + a prefix bonus (prefix up to 4 chars, p=0.1). */
export function jaroWinkler(a: string, b: string, p = 0.1): number {
  const base = jaro(a, b);
  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return base + prefix * p * (1 - base);
}

/** Case-insensitive token containment: 'nasi goreng' ⊂ 'nasi goreng special'. */
export function tokenContainment(a: string, b: string): boolean {
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return false;
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return shorter.every((t) => longer.includes(t));
}

/**
 * Suggest gate (master record): suggest a merge when JW similarity ≥ 0.88 OR
 * token containment with length ratio ≥ 0.8. NEVER auto-merge.
 */
export function suggestMerge(a: string, b: string, jwThreshold = 0.88, containmentLengthRatio = 0.8): {
  suggest: boolean;
  jw: number;
  reason: 'none' | 'similarity' | 'containment' | 'both';
} {
  const ja = normName(a.trim());
  const jb = normName(b.trim());
  if (ja === jb) return { suggest: true, jw: 1, reason: 'both' };
  const jw = jaroWinkler(ja, jb);
  const bySim = jw >= jwThreshold;
  const ratio = Math.min(ja.length, jb.length) / Math.max(ja.length, jb.length, 1);
  const byContain = tokenContainment(ja, jb) && ratio >= containmentLengthRatio;
  if (bySim && byContain) return { suggest: true, jw, reason: 'both' };
  if (bySim) return { suggest: true, jw, reason: 'similarity' };
  if (byContain) return { suggest: true, jw, reason: 'containment' };
  return { suggest: false, jw, reason: 'none' };
}
