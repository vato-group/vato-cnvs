import { create } from "zustand";

/**
 * Ephemeral multi-selection of WINDOWS (terminals / agents / browsers). The DOM
 * windows live outside Excalidraw's element model, so their selection is tracked
 * here and driven by the marquee in `useWindowMarquee` + click in WindowFrame.
 * Not persisted, cleared on focus-mode enter / workspace switch.
 */
interface SelectionState {
  selectedIds: string[];
  setSelected: (ids: string[]) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

export const useSelection = create<SelectionState>((set) => ({
  selectedIds: [],
  setSelected: (ids) => set({ selectedIds: ids }),
  toggle: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clear: () => set((s) => (s.selectedIds.length ? { selectedIds: [] } : s)),
}));
