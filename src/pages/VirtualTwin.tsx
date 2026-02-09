/**
 * Virtual Twin Page — thin wrapper around UnifiedViewer.
 * Route: /virtual-twin?building=<fmGuid>
 */
import UnifiedViewer from './UnifiedViewer';

export default function VirtualTwin() {
  return <UnifiedViewer initialMode="vt" />;
}
