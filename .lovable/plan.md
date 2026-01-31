
# Plan: English AI Onboarding Wizard & Mobile 3D Viewer Menu Fix

## Overview

This plan implements two major features:
1. **English AI Onboarding Wizard** - Interactive questionnaire with AI-generated personalized welcome
2. **Mobile 3D Viewer Menu Fix** - Resolve overlapping menus by hiding visualization controls behind a hamburger

---

## Part 1: Mobile 3D Viewer Menu Layout Fix

### Current Problem

On mobile, two UI elements compete for bottom screen space:
- **MobileViewerOverlay** (line 2400-2412): Bottom action bar with `Spaces`, `Floors`, `Reset` buttons
- **ViewerToolbar** (line 2548-2556): Bottom toolbar with zoom/select/measure tools

Both render with absolute positioning at the bottom, causing overlap.

### Solution: Hidden Right-Side Visualization Drawer

**Before (overlapping):**
```
+-----------------------------------+
|  [<] Building Name (2/5) [Tree]   |
|                                   |
|           3D Canvas               |
|                    [NavCube]      |
+-----------------------------------+
|  [Spaces] [Floors] [Reset]        |  ← MobileViewerOverlay
|  [+]  [-]  [Focus] [Select] [...] |  ← ViewerToolbar (OVERLAPPING!)
+-----------------------------------+
```

**After (clean layout):**
```
+-----------------------------------+
|  [<] Building Name (2/5) [Tree] ☰ | ← Hamburger for visualization
|                                   |
|           3D Canvas               |
|                    [NavCube]      |
+-----------------------------------+
|  [+]  [-]  [Focus] [Select] [...] |  ← ViewerToolbar only
+-----------------------------------+

When hamburger tapped - right drawer slides in:
+----------------------+------------+
|                      | Settings   |
|    3D Canvas         | [x] Spaces |
|                      | [Floors]   |
|                      | [Reset]    |
+----------------------+------------+
```

### Technical Changes

**File: `src/components/viewer/mobile/MobileViewerOverlay.tsx`**

Transform from bottom bar to right-side drawer:
- Remove the `absolute bottom-0` action bar
- Add hamburger button to header (top-right, after Tree button)
- Create right-side sliding drawer with controls
- Include Spaces toggle, Floors drawer trigger, Reset button

**File: `src/components/viewer/AssetPlusViewer.tsx`**

Minor adjustments:
- Ensure ViewerToolbar is the only bottom element on mobile
- Pass new props to MobileViewerOverlay for drawer state

---

## Part 2: English AI Onboarding Wizard

### User Flow

```
Step 1: Welcome          Step 2: Role            Step 3: Goals
+------------------+     +------------------+     +------------------+
| Welcome to       |     | What's your      |     | What would you   |
| Geminus!         |     | role?            |     | like to do?      |
|                  |     |                  |     |                  |
| Let's create a   |     | ○ FM Technician  |     | □ Register       |
| personalized     |     | ○ Property Mgr   |     |   inventory      |
| experience.      |     | ○ Consultant     |     | □ Explore 3D     |
|                  |     | ○ Other          |     |   models         |
|                  |     |                  |     | □ View insights  |
|   [Get Started]  |     |    [Continue]    |     |    [Finish]      |
+------------------+     +------------------+     +------------------+

Step 4: AI Welcome (generates personalized message)
+--------------------------------------------------+
| Your Personal Welcome                             |
|                                                  |
| "Welcome to Geminus! As an FM Technician,        |
| you'll find our inventory tools invaluable       |
| for tracking fire safety equipment..."           |
|                                                  |
| 🔊 [Listen] (text-to-speech via Web Speech API)  |
|                                                  |
|               [Start Exploring →]                |
+--------------------------------------------------+
```

### Files to Create

| File | Description |
|------|-------------|
| `src/pages/Onboarding.tsx` | Main onboarding page with step navigation |
| `src/components/onboarding/WelcomeStep.tsx` | Welcome screen |
| `src/components/onboarding/RoleSelector.tsx` | Role selection (radio buttons with icons) |
| `src/components/onboarding/GoalsSelector.tsx` | Goals multi-select (checkboxes) |
| `src/components/onboarding/OnboardingComplete.tsx` | AI-generated welcome with TTS |
| `supabase/functions/generate-onboarding/index.ts` | Lovable AI script generation |

### Database Schema

```sql
-- Table: onboarding_sessions
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT, -- 'fm_technician', 'property_manager', 'consultant', 'other'
  goals TEXT[], -- ['inventory', 'viewer', 'insights', 'navigate']
  script_content TEXT, -- AI-generated welcome message
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policy
ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own onboarding"
  ON onboarding_sessions
  FOR ALL
  USING (auth.uid() = user_id);
```

### Edge Function: generate-onboarding

Uses Lovable AI (google/gemini-3-flash-preview) to generate personalized welcome:

```typescript
// Key prompt structure
const systemPrompt = `You are a friendly onboarding assistant for Geminus, 
a digital twin platform for facility management.

Generate a short, warm welcome message (2-3 paragraphs) for a new user.
Tailor the message to their role and selected goals.
Include 2-3 specific tips for getting started.
Be professional but friendly.
Write in English.`;

const userPrompt = `User profile:
- Role: ${role}
- Goals: ${goals.join(', ')}

Generate a personalized welcome message.`;
```

### Text-to-Speech (Free)

Uses Web Speech API for audio playback:

```typescript
const speak = (text: string) => {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
};
```

### Route Integration

```typescript
// In App.tsx
<Route 
  path="/onboarding" 
  element={
    <ProtectedRoute>
      <Onboarding />
    </ProtectedRoute>
  } 
/>
```

### Navigation Logic

After login, check if user has completed onboarding:
- If no `onboarding_sessions` record exists with `completed_at` → redirect to `/onboarding`
- If completed → proceed to home

---

## Technical Summary

### New Files

| File | Description |
|------|-------------|
| `src/pages/Onboarding.tsx` | Main onboarding page (step wizard) |
| `src/components/onboarding/WelcomeStep.tsx` | Welcome screen with illustration |
| `src/components/onboarding/RoleSelector.tsx` | Role selection with icons |
| `src/components/onboarding/GoalsSelector.tsx` | Multi-select goals |
| `src/components/onboarding/OnboardingComplete.tsx` | AI message + TTS |
| `supabase/functions/generate-onboarding/index.ts` | Lovable AI integration |

### Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add `/onboarding` route |
| `src/components/viewer/mobile/MobileViewerOverlay.tsx` | Convert bottom bar to right drawer |
| `src/components/viewer/AssetPlusViewer.tsx` | Simplify mobile rendering |
| `supabase/config.toml` | Add generate-onboarding function config |

### Database Migration

```sql
-- Create onboarding_sessions table
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT,
  goals TEXT[],
  script_content TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access their own onboarding data
CREATE POLICY "Users can manage own onboarding"
  ON onboarding_sessions
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## Implementation Order

1. **Mobile 3D Viewer fix** - Transform MobileViewerOverlay to right drawer
2. **Database migration** - Create onboarding_sessions table
3. **Edge function** - Create generate-onboarding with Lovable AI
4. **Onboarding components** - Build step-by-step wizard UI
5. **Route integration** - Add /onboarding route and redirect logic

---

## Free Video Alternative Note

For the jury pitch, the plan uses:
- **Text-to-Speech** via Web Speech API (completely free, browser-native)
- **AI Script Generation** via Lovable AI (already configured)

Future enhancement options:
- **Google Veo 3.1** - For ambient background videos (free tier available)
- **HeyGen/Synthesia** - For avatar talking-head videos (paid)
