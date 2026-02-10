import { describe, it, expect } from 'vitest';
import { runTest } from './index';

describe('runTest', () => {
  it('should return true', () => {
    expect(runTest()).toBe(true);
  });
});
