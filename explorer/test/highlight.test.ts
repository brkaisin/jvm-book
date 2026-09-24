import { describe, expect, it } from 'vitest';
import { highlightJava } from '../src/lab/highlight';

describe('highlightJava', () => {
  it('marks keywords, types, numbers, strings and comments', () => {
    const html = highlightJava('static int f() { return 42; } // hi\nString s = "a<b";');
    expect(html).toContain('<span class="t-keyword">static</span>');
    expect(html).toContain('<span class="t-type">int</span>');
    expect(html).toContain('<span class="t-number">42</span>');
    expect(html).toContain('<span class="t-comment">// hi</span>');
    expect(html).toContain('<span class="t-string">"a&lt;b"</span>');
  });

  it('keeps the text intact once tags are removed (the overlay must line up with the textarea)', () => {
    const src = 'class Main {\n  /* x < y */ int a = 1 & 2;\n  String s = "unterminated\n}';
    const text = highlightJava(src)
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    expect(text).toBe(src);
  });
});
