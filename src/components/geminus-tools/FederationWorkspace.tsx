import React, { useState } from 'react';
import StoreyReconciliationMatrix, {
  ReconciliationMatrix,
  Overrides,
} from './StoreyReconciliationMatrix';
import FederationViewer, { FederationViewerModel } from './FederationViewer';

/**
 * FederationWorkspace — ties Phase 4's matrix to Phase 6's viewer.
 *
 * Linked selection is intentionally simple and one-directional for v1:
 * hovering a model's column header in the matrix fades every other
 * discipline in the 3D view. The plan's stated reason for the viewer
 * (catching coordinate misalignment between models) only needs this
 * model-level link, not object/storey-level — see FederationViewer.tsx's
 * doc comment for why the reverse direction (click an object in 3D, highlight
 * its row in the matrix) isn't built yet.
 */
export interface FederationWorkspaceProps {
  matrix: ReconciliationMatrix;
  /** One entry per model in `matrix.models`, providing its XKT source + colour. */
  viewerModels: FederationViewerModel[];
  onCanonicalNameChange?: (fmguid: string, newName: string) => void;
  onConfirm: (overrides: Overrides) => void;
  confirming?: boolean;
}

export default function FederationWorkspace({
  matrix,
  viewerModels,
  onCanonicalNameChange,
  onConfirm,
  confirming,
}: FederationWorkspaceProps) {
  const [focusedModelName, setFocusedModelName] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
      <div className="overflow-y-auto">
        <StoreyReconciliationMatrix
          matrix={matrix}
          onCanonicalNameChange={onCanonicalNameChange}
          onConfirm={onConfirm}
          confirming={confirming}
          onModelHover={setFocusedModelName}
        />
      </div>
      <div className="min-h-[400px]">
        <FederationViewer models={viewerModels} focusedModelName={focusedModelName} />
      </div>
    </div>
  );
}
