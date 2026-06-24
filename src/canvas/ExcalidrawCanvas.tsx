import { useEffect, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { Workspace } from "../types";
import { useStore } from "../store";
import { getExcalidrawApi, selectTool, setExcalidrawApi, selectionSignature, setFocusMode, useCanvasState, type ToolType } from "./canvasState";
import { loadSceneFiles, pruneFiles, referencedFileIds, saveSceneFiles, type StoredFiles } from "./sceneFiles";

interface Props {
  workspace: Workspace;
}

/**
 * Excalidraw IS the infinite canvas / whiteboard. Terminals and browsers are
 * DOM windows rendered on top (see Canvas.tsx), tracking this viewport.
 */
export function ExcalidrawCanvas({ workspace }: Props) {
  const saveScene = useStore((s) => s.saveScene);
  const saveView = useStore((s) => s.saveView);
  const ready = useCanvasState((s) => s.ready);
  const sceneTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const wsId = workspace.id;

  // Latest scene snapshot, kept in refs so the debounced/flush writers always
  // read the current state without re-subscribing.
  const elementsRef = useRef<any[]>(workspace.scene ?? []);
  const filesRef = useRef<StoredFiles>({});
  // Guards against clobbering the stored images with an empty map before the
  // async IndexedDB load has populated them.
  const filesLoadedRef = useRef(false);
  // Signature of the image set last written, to skip redundant IndexedDB writes
  // on pure drawing edits (image bytes are immutable per fileId).
  const lastFilesSig = useRef("");
  const persistRef = useRef<() => void>(() => {});

  // Seed the live viewport store from the saved snapshot on (re)mount.
  useEffect(() => {
    useCanvasState.getState().setViewport({
      scrollX: workspace.view.scrollX,
      scrollY: workspace.view.scrollY,
      zoom: workspace.view.zoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // Default the canvas tool to Hand (pan) on each fresh mount — Excalidraw boots
  // on "selection" and applies that AFTER the API goes live, so defer past the
  // init tick (a synchronous set here gets clobbered).
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => getExcalidrawApi()?.setActiveTool({ type: "hand" }), 0);
    return () => window.clearTimeout(id);
  }, [wsId, ready]);

  // Restore persisted image binaries once Excalidraw is ready (they're kept in
  // IndexedDB, not localStorage — see sceneFiles.ts). Image elements already
  // come back via initialData; addFiles makes them actually render.
  useEffect(() => {
    filesLoadedRef.current = false;
    if (!ready) return;
    let cancelled = false;
    loadSceneFiles(wsId).then((files) => {
      if (cancelled) return;
      const arr = Object.values(files);
      const api = getExcalidrawApi();
      if (arr.length && api) api.addFiles(arr as any);
      filesRef.current = files;
      lastFilesSig.current = Object.keys(files).sort().join(",");
      filesLoadedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [wsId, ready]);

  // Flush the pending save on unmount (workspace switch) and on tab close so the
  // last <500ms of edits aren't lost. Scene goes to localStorage synchronously;
  // images are a best-effort IndexedDB write.
  useEffect(() => {
    const onBeforeUnload = () => persistRef.current();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.clearTimeout(sceneTimer.current);
      persistRef.current();
      setExcalidrawApi(null);
      useCanvasState.getState().setReady(false);
    };
  }, []);

  // Wheel zoom/pan is owned by the single capture-phase handler in Canvas.tsx
  // (so the gesture works over windows/titlebars too, not just the bare canvas).

  // Write the current scene to the store (localStorage) + image binaries to
  // IndexedDB. Skips the (costly) file write when the referenced image set is
  // unchanged, and never writes files before the initial load (would clobber).
  const persist = () => {
    saveScene(wsId, elementsRef.current);
    if (!filesLoadedRef.current) return;
    const ids = referencedFileIds(elementsRef.current);
    const sig = [...ids].sort().join(",");
    if (sig === lastFilesSig.current) return;
    lastFilesSig.current = sig;
    saveSceneFiles(wsId, pruneFiles(filesRef.current, ids));
  };
  persistRef.current = persist;

  const onChange = (elements: readonly any[], appState: any, files: StoredFiles) => {
    const cs = useCanvasState.getState();
    const zoom = appState.zoom?.value ?? 1;
    const scrollX = appState.scrollX ?? 0;
    const scrollY = appState.scrollY ?? 0;

    // Update the live viewport only when it actually changed (drawing fires a lot).
    // The window overlay reads scroll/zoom from here and tracks it 1:1 (coupled).
    if (scrollX !== cs.scrollX || scrollY !== cs.scrollY || zoom !== cs.zoom) {
      cs.syncViewport(scrollX, scrollY, zoom);
      saveView(wsId, { scrollX, scrollY, zoom });
      // A canvas pan/zoom (hand-tool drag, trackpad, wheel) while focused releases
      // focus so the mosaic springs back to the free layout.
      if (useStore.getState().focusMode) setFocusMode(false);
    }
    const tool = appState.activeTool?.type as ToolType | undefined;
    if (tool && tool !== cs.activeTool) {
      // Excalidraw auto-reverts to "selection" after finishing a shape/drag (and
      // on Escape). Hand (pan) is the app's resting tool, so bounce that auto-
      // revert back to Hand. Explicit picks go through selectTool(), which sets
      // cs.activeTool first, so a user choosing Selection never lands here.
      if (tool === "selection" && cs.activeTool !== "selection") selectTool("hand");
      else cs.setActiveTool(tool);
    }

    // Tell the style panel to refresh iff the selection or its style changed.
    cs.bumpStyle(selectionSignature(elements, appState));

    elementsRef.current = elements as any[];
    if (files) filesRef.current = files;

    // Persist the scene + images (debounced).
    window.clearTimeout(sceneTimer.current);
    sceneTimer.current = window.setTimeout(persist, 500);
  };

  return (
    <div ref={rootRef} className="vato-excalidraw" style={{ position: "absolute", inset: 0, zIndex: 1 }}>
      <Excalidraw
        excalidrawAPI={(api: any) => {
          setExcalidrawApi(api);
          useCanvasState.getState().setReady(true);
        }}
        theme="dark"
        initialData={{
          elements: workspace.scene ?? [],
          appState: {
            viewBackgroundColor: "transparent",
            scrollX: workspace.view.scrollX,
            scrollY: workspace.view.scrollY,
            zoom: { value: workspace.view.zoom as any },
          },
          scrollToContent: false,
        }}
        onChange={onChange}
        UIOptions={{
          canvasActions: {
            toggleTheme: false,
            changeViewBackgroundColor: false,
            clearCanvas: false,
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            saveAsImage: false,
          },
        }}
      />
    </div>
  );
}
