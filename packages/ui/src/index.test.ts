import { describe, expect, it } from 'vitest';
import ui from './index';

describe('ui', () => {
  it('runs a test', () => {
    expect(ui).toStrictEqual('foo');
  });
});
