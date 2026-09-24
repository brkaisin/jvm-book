// A small Java syntax highlighter for the Code Lab's editor: good enough for
// the language subset, and safe (everything is HTML-escaped).

const KEYWORDS = new Set([
  'class', 'record', 'static', 'public', 'private', 'final', 'void', 'return', 'if', 'else', 'while', 'for',
  'new', 'this', 'null', 'true', 'false', 'break', 'continue',
]);
const TYPES = new Set(['int', 'boolean', 'String']);

const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"?)|(\b\d+\b)|([A-Za-z_$][\w$]*)|([\s\S])/g;

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Java source to HTML with `<span class="t-...">` tokens. */
export function highlightJava(src: string): string {
  let out = '';
  for (const m of src.matchAll(TOKEN)) {
    const [text, comment, str, num, word] = m;
    const esc = escapeHtml(text);
    if (comment) out += `<span class="t-comment">${esc}</span>`;
    else if (str) out += `<span class="t-string">${esc}</span>`;
    else if (num) out += `<span class="t-number">${esc}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="t-keyword">${esc}</span>`;
    else if (word && (TYPES.has(word) || /^[A-Z]/.test(word))) out += `<span class="t-type">${esc}</span>`;
    else out += esc;
  }
  return out;
}
