import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/lib/index.js';

describe('shared skeleton', () => {
  it('exports a version', () => {
    expect(VERSION).toBe(1);
  });
});
