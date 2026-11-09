import { describe, expect, it } from 'vitest';
import { orderKeyBetween, orderKeysBetween } from './order-key.js';

describe('orderKeyBetween', () => {
  it('generates strictly increasing keys when appending', () => {
    let prev: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 500; i++) {
      prev = orderKeyBetween(prev, null);
      keys.push(prev);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('inserts between any two keys, repeatedly', () => {
    let a = orderKeyBetween(null, null);
    const b = orderKeyBetween(a, null);
    for (let i = 0; i < 200; i++) {
      const m = orderKeyBetween(a, b);
      expect(a < m && m < b).toBe(true);
      a = m;
    }
  });

  it('inserts before the first key', () => {
    const first = orderKeyBetween(null, null);
    const before = orderKeyBetween(null, first);
    expect(before < first).toBe(true);
  });

  it('bulk keys are ordered', () => {
    const keys = orderKeysBetween(null, null, 50);
    expect([...keys].sort()).toEqual(keys);
  });

  it('rejects inverted bounds', () => {
    expect(() => orderKeyBetween('b', 'a')).toThrow();
  });
});
