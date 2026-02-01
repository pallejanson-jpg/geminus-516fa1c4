import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import WelcomeStep from '@/components/onboarding/WelcomeStep';
import RoleSelector, { UserRole } from '@/components/onboarding/RoleSelector';
import GoalsSelector, { UserGoal } from '@/components/onboarding/GoalsSelector';
import OnboardingComplete from '@/components/onboarding/OnboardingComplete';

type OnboardingStep = 'welcome' | 'role' | 'goals' | 'complete';

const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [role, setRole] = useState<UserRole | null>(null);
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [script, setScript] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Get current user on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        
        // Check if user already completed onboarding
        const { data } = await supabase
          .from('onboarding_sessions')
          .select('completed_at')
          .eq('user_id', user.id)
          .not('completed_at', 'is', null)
          .maybeSingle();
        
        if (data?.completed_at) {
          // Already completed - redirect to home
          navigate('/', { replace: true });
        }
      }
    };
    getUser();
  }, [navigate]);

  // Generate AI script
  const generateScript = useCallback(async () => {
    if (!role) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-onboarding', {
        body: { role, goals },
      });
      
      if (fnError) throw fnError;
      
      if (data?.script) {
        setScript(data.script);
      } else if (data?.error) {
        throw new Error(data.error);
      }
    } catch (err) {
      console.error('Failed to generate onboarding script:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate welcome message');
      // Set a fallback script
      setScript(`Welcome to Geminus! We're excited to have you on board.

As a ${role === 'fm_technician' ? 'Facility Management Technician' : role === 'property_manager' ? 'Property Manager' : role === 'consultant' ? 'FM Consultant' : 'professional'}, you'll find powerful tools to help you manage your buildings more effectively.

Get started by exploring the 3D viewer to navigate your building models, or check out the inventory section to register and track your assets. If you need any help, our AI assistant is always available.`);
    } finally {
      setIsGenerating(false);
    }
  }, [role, goals]);

  // Handle step transitions
  const handleGoToRole = () => setStep('role');
  const handleGoToGoals = () => setStep('goals');
  const handleBackToWelcome = () => setStep('welcome');
  const handleBackToRole = () => setStep('role');

  // Handle skip onboarding
  const handleSkip = async () => {
    if (!userId) {
      navigate('/');
      return;
    }
    
    try {
      await supabase
        .from('onboarding_sessions')
        .upsert({
          user_id: userId,
          role: null,
          goals: [],
          script_content: null,
          completed_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });
      
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Skip onboarding error:', err);
      navigate('/', { replace: true });
    }
  };

  // Handle completion of goals step - generate script and move to complete
  const handleFinishGoals = async () => {
    setStep('complete');
    await generateScript();
  };

  // Save onboarding and navigate to app
  const handleStart = async () => {
    if (!userId) {
      navigate('/');
      return;
    }
    
    try {
      // Save or update onboarding session
      const { error: saveError } = await supabase
        .from('onboarding_sessions')
        .upsert({
          user_id: userId,
          role,
          goals,
          script_content: script || null,
          completed_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });
      
      if (saveError) {
        console.error('Failed to save onboarding:', saveError);
        // Continue anyway - don't block user
      }
      
      toast.success('Welcome to Geminus!');
      navigate('/', { replace: true });
    } catch (err) {
      console.error('Onboarding save error:', err);
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress indicator */}
      <div className="w-full h-1 bg-muted">
        <div 
          className="h-full bg-primary transition-all duration-300"
          style={{ 
            width: step === 'welcome' ? '25%' : 
                   step === 'role' ? '50%' : 
                   step === 'goals' ? '75%' : '100%' 
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
        {step === 'welcome' && (
          <WelcomeStep onNext={handleGoToRole} onSkip={handleSkip} />
        )}
        
        {step === 'role' && (
          <RoleSelector
            selectedRole={role}
            onRoleChange={setRole}
            onNext={handleGoToGoals}
            onBack={handleBackToWelcome}
          />
        )}
        
        {step === 'goals' && (
          <GoalsSelector
            selectedGoals={goals}
            onGoalsChange={setGoals}
            onNext={handleFinishGoals}
            onBack={handleBackToRole}
            isLoading={isGenerating}
          />
        )}
        
        {step === 'complete' && (
          <OnboardingComplete
            script={script}
            isLoading={isGenerating}
            error={error}
            onStart={handleStart}
          />
        )}
      </div>
    </div>
  );
};

export default Onboarding;
