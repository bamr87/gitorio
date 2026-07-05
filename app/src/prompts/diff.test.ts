import { describe, expect, it } from 'vitest';
import { diffLines, hasChanges } from './diff';

describe('diffLines', () => {
  it('marks unchanged lines as same', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ]);
  });

  it('detects an added line', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'add', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('detects a removed line', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('models a changed line as del + add', () => {
    const rows = diffLines('hello', 'goodbye');
    expect(rows).toEqual([
      { kind: 'del', text: 'hello' },
      { kind: 'add', text: 'goodbye' },
    ]);
  });

  it('hasChanges is false only for identical text', () => {
    expect(hasChanges('x', 'x')).toBe(false);
    expect(hasChanges('x', 'y')).toBe(true);
  });
});
