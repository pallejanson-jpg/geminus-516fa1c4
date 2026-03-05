/**
 * Split Viewer Page — thin wrapper around UnifiedViewer.
 * Route: /split-viewer?building=<fmGuid>
 * 
 * Kept for backwards compatibility — redirects to /viewer with same params.
 */
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function SplitViewer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  useEffect(() => {
    // Redirect to /viewer preserving all query params
    const params = searchParams.toString();
    navigate(`/viewer${params ? `?${params}` : ''}`, { replace: true });
  }, [navigate, searchParams]);
  
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
