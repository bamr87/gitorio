import { describe, expect, it } from 'vitest';
import { useUiStore, type AppView } from './ui';

describe('ui store', () => {
  it('starts on the Build tab', () => {
    expect(useUiStore.getState().view).toBe('build');
  });

  it('setView switches the active tab (deep-link path panels rely on)', () => {
    const views: AppView[] = ['monitor', 'fleet', 'settings', 'build'];
    for (const v of views) {
      useUiStore.getState().setView(v);
      expect(useUiStore.getState().view).toBe(v);
    }
  });
});
