// Command-palette fuzzy matching (⌘K, enrichment Phase 2). PURE + Cesium-free
// so it runs under `node --test`. Deliberately small: a substring hit ranks by
// how early it lands; otherwise an in-order subsequence match scores per hit
// with bonuses for word starts and adjacency. No dependencies.

export interface PaletteEntry {
  /** Display label — the primary match target. */
  label: string;
  /** Extra match terms (synonyms, group names) — matched at a small discount. */
  keywords?: string;
}

/** Score `query` against `text`. Higher is better; null = no match. */
export function scoreMatch(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;

  const at = t.indexOf(q);
  if (at >= 0) {
    // Substring: earlier + tighter is better; a word-start hit beats mid-word.
    const wordStart = at === 0 || /[\s/·-]/.test(t[at - 1]);
    return 1000 - at * 4 + (wordStart ? 40 : 0) - (t.length - q.length);
  }

  // In-order subsequence with gap penalties.
  let score = 0;
  let ti = 0;
  let prevHit = -2;
  for (const ch of q) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    score += 10;
    if (found === prevHit + 1) score += 6; // adjacency
    if (found === 0 || /[\s/·-]/.test(t[found - 1])) score += 8; // word start
    score -= Math.min(found - ti, 6); // gap penalty (capped)
    prevHit = found;
    ti = found + 1;
  }
  return score;
}

/** Rank `entries` for `query`: matched entries sorted by score (stable on ties
 * via original order); an empty query keeps the authored order. */
export function rankEntries<T extends PaletteEntry>(entries: T[], query: string): T[] {
  const q = query.trim();
  if (q.length === 0) return entries;
  const scored: Array<{ entry: T; score: number; order: number }> = [];
  entries.forEach((entry, order) => {
    const label = scoreMatch(q, entry.label);
    const kw = entry.keywords ? scoreMatch(q, entry.keywords) : null;
    // Keywords match at a discount so label hits always outrank synonym hits.
    const best = Math.max(label ?? -Infinity, kw !== null ? kw * 0.8 : -Infinity);
    if (best !== -Infinity) scored.push({ entry, score: best, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.entry);
}
