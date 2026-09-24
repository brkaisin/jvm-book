import { describe, expect, it } from 'vitest';
import { sentenceStarts } from '../src/ui/narratorView';

describe('sentenceStarts', () => {
  it('splits after sentence punctuation', () => {
    const t = 'The heap. It holds objects! Really? Yes: all of them.';
    expect(sentenceStarts(t).map((i) => t.slice(i, i + 3))).toEqual(['The', 'It ', 'Rea', 'Yes', 'all']);
  });

  it('does not split decimals or a final full stop', () => {
    expect(sentenceStarts('Version 1.2 is out.')).toEqual([0]);
  });
});
