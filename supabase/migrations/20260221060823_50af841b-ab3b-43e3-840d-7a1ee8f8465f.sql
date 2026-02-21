
-- Create gunnar_conversations table for conversation memory
CREATE TABLE public.gunnar_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  building_fm_guid TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.gunnar_conversations ENABLE ROW LEVEL SECURITY;

-- Users can only access their own conversations
CREATE POLICY "Users can view own conversations"
ON public.gunnar_conversations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
ON public.gunnar_conversations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
ON public.gunnar_conversations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations"
ON public.gunnar_conversations FOR DELETE
USING (auth.uid() = user_id);

-- Index for fast lookup by user + building
CREATE INDEX idx_gunnar_conversations_user_building
ON public.gunnar_conversations (user_id, building_fm_guid, updated_at DESC);

-- Trigger for auto-updating updated_at
CREATE TRIGGER update_gunnar_conversations_updated_at
BEFORE UPDATE ON public.gunnar_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
