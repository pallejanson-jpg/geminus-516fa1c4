/**
 * Project a 3D world position (xeokit local space) to 2D canvas pixel coordinates.
 * Shared by useViewerEventListeners.ts's DOM-marker annotation renderer and
 * XeokitViewerAdapter's showAnnotation() — both need the exact same math, so it lives
 * in one place instead of being copy-pasted.
 *
 * Returns [canvasX, canvasY, clipW] or null if the point can't be projected (e.g. no
 * camera/canvas yet). clipW > 0 means the point is in front of the camera.
 */
export function projectWorldToCanvas(
  camera: { projMatrix?: ArrayLike<number>; viewMatrix?: ArrayLike<number> } | undefined,
  canvas: HTMLCanvasElement | undefined | null,
  worldPos: [number, number, number],
): [number, number, number] | null {
  try {
    if (!camera) return null;
    if (!canvas) return null;
    const projMatrix = camera.projMatrix;
    const viewMatrix = camera.viewMatrix;
    if (!projMatrix || !viewMatrix) return null;

    const v = [worldPos[0], worldPos[1], worldPos[2], 1];
    const mv = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      mv[r] = viewMatrix[r] * v[0] + viewMatrix[r + 4] * v[1] + viewMatrix[r + 8] * v[2] + viewMatrix[r + 12] * v[3];
    }
    const clip = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      clip[r] = projMatrix[r] * mv[0] + projMatrix[r + 4] * mv[1] + projMatrix[r + 8] * mv[2] + projMatrix[r + 12] * mv[3];
    }
    if (clip[3] <= 0) return null;

    const ndc = [clip[0] / clip[3], clip[1] / clip[3], clip[2] / clip[3]];
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return [(ndc[0] + 1) * 0.5 * w, (1 - ndc[1]) * 0.5 * h, clip[3]];
  } catch {
    return null;
  }
}
