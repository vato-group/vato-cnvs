import { create } from "zustand";

/** Ephemeral state for an in-progress window tiling drag (live preview). */
interface DragState {
  draggingId: string | null;
  /** Preview order of window ids while dragging. */
  previewIds: string[] | null;
  /** Slot index the dragged window will land in. */
  previewIndex: number;

  begin: (id: string, ids: string[]) => void;
  preview: (ids: string[], index: number) => void;
  end: () => void;
}

export const useDrag = create<DragState>((set) => ({
  draggingId: null,
  previewIds: null,
  previewIndex: -1,
  begin: (id, ids) => set({ draggingId: id, previewIds: ids, previewIndex: ids.indexOf(id) }),
  preview: (ids, index) => set({ previewIds: ids, previewIndex: index }),
  end: () => set({ draggingId: null, previewIds: null, previewIndex: -1 }),
}));
