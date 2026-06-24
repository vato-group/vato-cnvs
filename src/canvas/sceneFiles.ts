/**
 * Persistence for Excalidraw *binary files* (the actual image bytes).
 *
 * An Excalidraw image element only stores a `fileId` + geometry — the image
 * data lives in a separate `BinaryFiles` map (`{ [fileId]: { dataURL, ... } }`).
 * The scene `elements` are persisted in the zustand store (localStorage), but
 * image dataURLs are base64 and routinely exceed localStorage's ~5MB quota, so
 * we keep them here in IndexedDB instead (hundreds of MB available), keyed per
 * workspace. Without this, images reload as blank placeholders.
 */

type BinaryFileData = { id: string; dataURL: string; mimeType: string; created?: number; lastRetrieved?: number };
export type StoredFiles = Record<string, BinaryFileData>;

const DB_NAME = "vato-cnvs-scene";
const STORE = "files";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Load the persisted image binaries for a workspace (empty map on any failure). */
export async function loadSceneFiles(wsId: string): Promise<StoredFiles> {
  try {
    const db = await openDb();
    return await new Promise<StoredFiles>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(wsId);
      req.onsuccess = () => resolve((req.result as StoredFiles) ?? {});
      req.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

/** Persist (overwrite) the image binaries for a workspace. Best effort. */
export async function saveSceneFiles(wsId: string, files: StoredFiles): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(files, wsId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best effort: a failed image save must never break the app.
  }
}

/** Drop a workspace's image binaries (called when the workspace is deleted). */
export async function deleteSceneFiles(wsId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(wsId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

/** Collect fileIds still referenced by (non-deleted) scene elements. */
export function referencedFileIds(elements: readonly any[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements) if (el && el.fileId && !el.isDeleted) ids.add(el.fileId);
  return ids;
}

/** Keep only the binaries referenced by the scene (prunes deleted images). */
export function pruneFiles(files: StoredFiles, ids: Set<string>): StoredFiles {
  const out: StoredFiles = {};
  for (const id of ids) if (files[id]) out[id] = files[id];
  return out;
}
