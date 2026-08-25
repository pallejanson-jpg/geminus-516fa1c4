import { useRef, useCallback, useState } from 'react';

interface Snapshot {
  visible: Map<string, boolean>;
}

export function useViewerHistory(getViewer: () => any) {
  const historyRef = useRef<Snapshot[]>([]);
  const posRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const capture = useCallback((): Snapshot => {
    const viewer = getViewer();
    const visible = new Map<string, boolean>();
    const objects = viewer?.scene?.objects;
    if (objects) {
      for (const [id, obj] of Object.entries(objects) as [string, any][]) {
        visible.set(id, !!obj.visible);
      }
    }
    return { visible };
  }, [getViewer]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    const viewer = getViewer();
    if (!viewer?.scene?.setObjectsVisible) return;
    const show: string[] = [];
    const hide: string[] = [];
    for (const [id, v] of snap.visible) {
      if (v) show.push(id); else hide.push(id);
    }
    if (show.length) viewer.scene.setObjectsVisible(show, true);
    if (hide.length) viewer.scene.setObjectsVisible(hide, false);
  }, [getViewer]);

  /** Call before each visibility-changing action to save previous state. */
  const push = useCallback(() => {
    const snap = capture();
    historyRef.current = historyRef.current.slice(0, posRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > 20) historyRef.current.shift();
    posRef.current = historyRef.current.length - 1;
    setCanUndo(posRef.current > 0);
    setCanRedo(false);
  }, [capture]);

  const undo = useCallback(() => {
    if (posRef.current <= 0) return;
    posRef.current -= 1;
    applySnapshot(historyRef.current[posRef.current]);
    setCanUndo(posRef.current > 0);
    setCanRedo(true);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (posRef.current >= historyRef.current.length - 1) return;
    posRef.current += 1;
    applySnapshot(historyRef.current[posRef.current]);
    setCanUndo(true);
    setCanRedo(posRef.current < historyRef.current.length - 1);
  }, [applySnapshot]);

  return { push, undo, redo, canUndo, canRedo };
}
