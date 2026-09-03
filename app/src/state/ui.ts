// App-shell view state: which top-level tab is active, plus the Build tab's console state
// (specs/013): Floor (the editing canvas) vs Map (each assembly line as an archify map), the
// floating Machine Finder, and the Blueprint passport. Kept out of App.tsx local state so any
// panel can deep-link (e.g. a map passport's "Edit on the floor" → Floor + select).

import { create } from 'zustand';

export type AppView =
  | 'build'
  | 'prompts'
  | 'content'
  | 'docs'
  | 'monitor'
  | 'fleet'
  | 'harness'
  | 'settings';
export type BuildMode = 'floor' | 'map';

interface UiState {
  view: AppView;
  setView: (v: AppView) => void;
  buildMode: BuildMode;
  setBuildMode: (m: BuildMode) => void;
  /** The Machine Finder (the palette, re-homed as archify's Node Finder). */
  finderOpen: boolean;
  setFinderOpen: (open: boolean) => void;
  /** The blueprint's own passport (name, target repo, description, overview). */
  blueprintPassportOpen: boolean;
  setBlueprintPassportOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  view: 'build',
  setView: (view) => set({ view }),
  buildMode: 'floor',
  setBuildMode: (buildMode) => set({ buildMode }),
  finderOpen: false,
  setFinderOpen: (finderOpen) => set({ finderOpen }),
  blueprintPassportOpen: false,
  setBlueprintPassportOpen: (blueprintPassportOpen) => set({ blueprintPassportOpen }),
}));
