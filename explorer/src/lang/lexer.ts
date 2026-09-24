// Turns source text into tokens, remembering where each one came from so
// errors can point at the right line and column.

export type TokenKind = 'ident' | 'keyword' | 'int' | 'string' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

/** A problem with the source, at a 1-based line and column. */
export class SourceError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(message);
  }
}

export const KEYWORDS = new Set([
  'class', 'record', 'static', 'public', 'private', 'protected', 'final', 'void', 'int', 'boolean',
  'if', 'else', 'while', 'for', 'return', 'new', 'true', 'false', 'null', 'this', 'break', 'continue', 'var',
]);

/** Longest first, so `<=` wins over `<`. */
const PUNCT = [
  '++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', '{', '}', '[', ']', ';', ',', '.',
];

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const col = () => i - lineStart + 1;

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new SourceError('This comment is never closed (missing */)', line, col());
      for (; i < end + 2; i++)
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
      continue;
    }
    const start = { line, col: col() };
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out.push({ kind: KEYWORDS.has(word) ? 'keyword' : 'ident', value: word, ...start });
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i;
      while (j < src.length && /[\d_]/.test(src[j])) j++;
      const text = src.slice(i, j).replace(/_/g, '');
      if (Number(text) > 2147483648) throw new SourceError(`The number ${text} is too large for an int`, line, start.col);
      out.push({ kind: 'int', value: text, ...start });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new SourceError('This string is never closed (missing ")', line, start.col);
        if (src[j] === '\\') {
          const e = src[++j];
          text += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else text += src[j];
        j++;
      }
      if (j >= src.length) throw new SourceError('This string is never closed (missing ")', line, start.col);
      out.push({ kind: 'string', value: text, ...start });
      i = j + 1;
      continue;
    }
    const p = PUNCT.find((x) => src.startsWith(x, i));
    if (!p) throw new SourceError(`Unexpected character '${c}'`, line, start.col);
    out.push({ kind: 'punct', value: p, ...start });
    i += p.length;
  }
  out.push({ kind: 'eof', value: '', line, col: col() });
  return out;
}
