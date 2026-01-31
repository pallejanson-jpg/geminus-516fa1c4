import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireAdmin = false }) => {
  const { user, isAdmin, isLoading } = useAuth();
  const location = useLocation();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  // Check if user has completed onboarding
  useEffect(() => {
    const checkOnboarding = async () => {
      if (!user) {
        setOnboardingChecked(true);
        return;
      }

      // Skip check if already on onboarding page
      if (location.pathname === '/onboarding') {
        setOnboardingChecked(true);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('onboarding_sessions')
          .select('id, completed_at')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking onboarding:', error);
          setOnboardingChecked(true);
          return;
        }

        // User needs onboarding if no session or not completed
        setNeedsOnboarding(!data || !data.completed_at);
        setOnboardingChecked(true);
      } catch (e) {
        console.error('Onboarding check failed:', e);
        setOnboardingChecked(true);
      }
    };

    if (!isLoading && user) {
      checkOnboarding();
    } else if (!isLoading) {
      setOnboardingChecked(true);
    }
  }, [user, isLoading, location.pathname]);

  if (isLoading || !onboardingChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    // User is logged in but not admin - redirect to home
    return <Navigate to="/" replace />;
  }

  // Redirect to onboarding if needed
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
