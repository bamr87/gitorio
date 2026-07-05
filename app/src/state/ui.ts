// App-shell view state: which top-level tab is active. Kept out of App.tsx local state so
// any panel can deep-link (e.g. Inspector's "open Monitor" → setView('monitor')).

import { create } from 'zustand';

export type AppView = 'build' | 'prompts' | 'content' | 'docs' | 'monitor' | 'fleet' | 'settings';

interface UiState {
  view: AppView;
  setView: (v: AppView) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: 'build',
  setView: (view) => set({ view }),
}));
