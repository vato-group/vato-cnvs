// Minimal pub/sub used for cross-pane signals (e.g. whiteboard -> terminal image).
type Handler = (payload: any) => void;

const channels = new Map<string, Set<Handler>>();

export const bus = {
  on(type: string, h: Handler): () => void {
    let set = channels.get(type);
    if (!set) {
      set = new Set();
      channels.set(type, set);
    }
    set.add(h);
    return () => {
      set!.delete(h);
    };
  },
  emit(type: string, payload?: any): void {
    channels.get(type)?.forEach((h) => h(payload));
  },
};
