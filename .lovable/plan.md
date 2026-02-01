
# Plan: Add "Skip Onboarding" Button

## Overview

Add a discrete "Skip" button to the WelcomeStep that allows users to bypass the onboarding flow entirely while still marking their session as complete in the database.

---

## Implementation

### File: `src/components/onboarding/WelcomeStep.tsx`

**Changes:**
1. Add `onSkip` prop to interface
2. Add a subtle "Skip" link below the main CTA button

```tsx
interface WelcomeStepProps {
  onNext: () => void;
  onSkip?: () => void;  // NEW
}

const WelcomeStep: React.FC<WelcomeStepProps> = ({ onNext, onSkip }) => {
  return (
    <div className="flex flex-col items-center ...">
      {/* ... existing content ... */}
      
      {/* CTA Button */}
      <Button size="lg" onClick={onNext} ...>
        Get Started
        <Sparkles className="w-4 h-4 ml-2" />
      </Button>
      
      {/* NEW: Skip link */}
      {onSkip && (
        <button
          onClick={onSkip}
          className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip for now
        </button>
      )}
    </div>
  );
};
```

---

### File: `src/pages/Onboarding.tsx`

**Changes:**
1. Add `handleSkip` function that saves a minimal onboarding session and navigates to home

```tsx
// Add skip handler
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

// Pass to WelcomeStep
{step === 'welcome' && (
  <WelcomeStep 
    onNext={handleGoToRole} 
    onSkip={handleSkip}  // NEW
  />
)}
```

---

## Visual Result

```
┌─────────────────────────────────────┐
│                                     │
│        [🏢] [📦]                    │
│        [📊] [✨]                    │
│                                     │
│      Welcome to Geminus             │
│   Your digital twin platform...     │
│                                     │
│    ┌─────────────────────┐          │
│    │   Get Started  ✨   │          │
│    └─────────────────────┘          │
│         Skip for now                │  ← NEW
│                                     │
└─────────────────────────────────────┘
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/onboarding/WelcomeStep.tsx` | Add `onSkip` prop and "Skip for now" button |
| `src/pages/Onboarding.tsx` | Add `handleSkip` function, pass to WelcomeStep |
