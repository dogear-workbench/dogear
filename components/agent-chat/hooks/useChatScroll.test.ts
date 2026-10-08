import { describe, expect, test } from 'bun:test';
import { shouldLeaveFollowModeForScroll } from './useChatScroll';

describe('shouldLeaveFollowModeForScroll', () => {
  test('非程序化向上滚动会退出自动跟随，滚动条拖拽也适用', () => {
    expect(shouldLeaveFollowModeForScroll(800, 300, false)).toBe(true);
  });

  test('程序滚动和向下滚动不退出自动跟随', () => {
    expect(shouldLeaveFollowModeForScroll(800, 300, true)).toBe(false);
    expect(shouldLeaveFollowModeForScroll(300, 800, false)).toBe(false);
  });
});
