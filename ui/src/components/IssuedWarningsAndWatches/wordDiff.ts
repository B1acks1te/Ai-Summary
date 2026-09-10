// Minimal word-level diff — deliberately dependency-free (no new package
// added just for this) rather than pulling in the full diff/react-diff-viewer
// machinery for a few short inline fields. Good enough for area names,
// period text, and short values; not intended for large paragraphs.

export type DiffToken = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

function tokenize(text: string): string[] {
  // Split on whitespace but keep the whitespace as its own token, so
  // spacing is preserved exactly when tokens are re-joined.
  return text.match(/\S+|\s+/g) ?? [];
}

// Classic LCS-based diff, applied over word tokens rather than characters.
// O(n*m) — fine for the short strings this is used on (area/period text).
export function diffWords(oldText: string, newText: string): DiffToken[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      tokens.push({ value: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ value: a[i], removed: true });
      i++;
    } else {
      tokens.push({ value: b[j], added: true });
      j++;
    }
  }
  while (i < n) {
    tokens.push({ value: a[i], removed: true });
    i++;
  }
  while (j < m) {
    tokens.push({ value: b[j], added: true });
    j++;
  }

  return tokens;
}

export function hasDiff(tokens: DiffToken[]): boolean {
  return tokens.some((t) => t.added || t.removed);
}