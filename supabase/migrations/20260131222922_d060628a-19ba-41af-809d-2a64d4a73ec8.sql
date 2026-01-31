-- Create onboarding_sessions table for AI onboarding wizard
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT, -- 'fm_technician', 'property_manager', 'consultant', 'other'
  goals TEXT[], -- ['inventory', 'viewer', 'insights', 'navigate']
  script_content TEXT, -- AI-generated welcome message
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: users can only access their own onboarding data
CREATE POLICY "Users can view own onboarding"
  ON onboarding_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding"
  ON onboarding_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding"
  ON onboarding_sessions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Add index for faster user lookups
CREATE INDEX idx_onboarding_sessions_user_id ON onboarding_sessions(user_id);