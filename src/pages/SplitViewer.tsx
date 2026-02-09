/**
 * Split Viewer Page — thin wrapper around UnifiedViewer.
 * Route: /split-viewer?building=<fmGuid>
 */
import UnifiedViewer from './UnifiedViewer';

export default function SplitViewer() {
  return <UnifiedViewer initialMode="split" />;
}
