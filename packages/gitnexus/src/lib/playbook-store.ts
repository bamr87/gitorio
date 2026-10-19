import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

type PlaybookState = {
  checked: Record<string, boolean>;
  toggle: (id: string) => void;
  reset: () => void;
};

export const usePlaybook = create<PlaybookState>()(
  persist(
    (set) => ({
      checked: {},
      toggle: (id) =>
        set((s) => ({ checked: { ...s.checked, [id]: !s.checked[id] } })),
      reset: () => set({ checked: {} }),
    }),
    {
      name: "nexus-forge-playbook",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : localStorage,
      ),
    },
  ),
);
