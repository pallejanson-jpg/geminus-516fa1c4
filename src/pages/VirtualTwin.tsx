/**
 * Virtual Twin Page — redirects to /viewer with mode=vt.
 * Route: /virtual-twin?building=<fmGuid>
 */
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function VirtualTwin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (!params.has('mode')) params.set('mode', 'vt');
    navigate(`/viewer?${params.toString()}`, { replace: true });
  }, [navigate, searchParams]);
  
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}
