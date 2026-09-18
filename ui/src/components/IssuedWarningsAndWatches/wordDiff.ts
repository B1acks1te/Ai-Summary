// Minimal word-level diff — deliberately dependency-free (no new package
// added just for this) rather than pulling in the full diff/react-diff-viewer
// machinery for a few short inline fields. Good enough for area names,
// period text, and short values; not intended for large paragraphs.
//
// Only real words count as changes. Punctuation (commas, dashes, full stops),
// spacing and the connective "and" are carried through in the output so the
// text reads exactly as written, but they are never compared or highlighted
// on their own — so "Southland and Clutha" -> "Southland, Clutha and Dunedin"
// highlights just "Dunedin", not the commas or the shuffled "and".

export type DiffToken = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

type Tok = { text: string; word: boolean };

// A word is a run of letters/digits (any language, so macrons are fine),
// optionally with internal apostrophes (Hawke's). Whitespace runs and single
// punctuation characters are their own tokens.
const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|\s+|[^\s]/gu;
const WORD_RE = /[\p{L}\p{N}]/u;

// Connectives that shouldn't trigger or carry a highlight by themselves.
const IGNORED_WORDS = new Set(['and']);

function tokenize(text: string): Tok[] {
  const raw = text.match(TOKEN_RE) ?? [];
  return raw.map((t) => ({
    text: t,
    word: WORD_RE.test(t) && !IGNORED_WORDS.has(t.toLowerCase()),
  }));
}

type Op = { kind: 'equal' | 'added' | 'removed'; value: string };

// Classic LCS-based diff over the significant words only.
// O(n*m) — fine for the short strings this is used on (area/period text).
function diffWordOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', value: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'removed', value: a[i] });
      i++;
    } else {
      ops.push({ kind: 'added', value: b[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: 'removed', value: a[i++] });
  }
  while (j < m) {
    ops.push({ kind: 'added', value: b[j++] });
  }
  return ops;
}

export function diffWords(oldText: string, newText: string): DiffToken[] {
  const oldToks = tokenize(oldText);
  const newToks = tokenize(newText);

  const ops = diffWordOps(
    oldToks.filter((t) => t.word).map((t) => t.text),
    newToks.filter((t) => t.word).map((t) => t.text),
  );

  // Walk the NEW text in order (so it is reproduced exactly, punctuation and
  // spacing included), flagging each significant word as added or not, and
  // slotting removed words in where they used to be.
  const out: (DiffToken & { word?: boolean })[] = [];
  let opIdx = 0;
  const flushRemoved = () => {
    while (opIdx < ops.length && ops[opIdx].kind === 'removed') {
      out.push({ value: ops[opIdx].value, removed: true });
      opIdx++;
    }
  };

  for (const tok of newToks) {
    if (!tok.word) {
      out.push({ value: tok.text });
      continue;
    }
    flushRemoved();
    const op = ops[opIdx++];
    out.push({
      value: tok.text,
      added: op?.kind === 'added' ? true : undefined,
      word: true,
    });
  }
  flushRemoved();

  // Between two added words, the spacing/punctuation/"and" joining them is
  // highlighted too, so a run like "Clutha and Dunedin" shows as one
  // continuous block instead of separate boxes with gaps.
  for (let k = 0; k < out.length; k++) {
    const t = out[k];
    if (t.word || t.removed) continue;
    let prev = k - 1;
    while (prev >= 0 && (out[prev].removed || !out[prev].word)) prev--;
    let next = k + 1;
    while (next < out.length && (out[next].removed || !out[next].word)) next++;
    if (
      prev >= 0 &&
      next < out.length &&
      out[prev].added &&
      out[next].added
    ) {
      t.added = true;
    }
  }

  // Merge neighbouring tokens with the same flags into one, so each
  // highlighted run renders as a single span.
  const merged: DiffToken[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (last && !!last.added === !!t.added && !!last.removed === !!t.removed) {
      last.value += t.value;
    } else {
      merged.push({
        value: t.value,
        ...(t.added ? { added: true } : {}),
        ...(t.removed ? { removed: true } : {}),
      });
    }
  }
  return merged;
}

export function hasDiff(tokens: DiffToken[]): boolean {
  return tokens.some((t) => t.added || t.removed);
}