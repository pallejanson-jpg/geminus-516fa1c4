
-- Create table for storing Autodesk 3-legged OAuth tokens
CREATE TABLE public.acc_oauth_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT acc_oauth_tokens_user_id_unique UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.acc_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tokens
CREATE POLICY "Users can view own ACC tokens"
ON public.acc_oauth_tokens
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own tokens
CREATE POLICY "Users can insert own ACC tokens"
ON public.acc_oauth_tokens
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own tokens
CREATE POLICY "Users can update own ACC tokens"
ON public.acc_oauth_tokens
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own tokens (logout)
CREATE POLICY "Users can delete own ACC tokens"
ON public.acc_oauth_tokens
FOR DELETE
USING (auth.uid() = user_id);

-- Service role needs full access for token refresh from edge functions
CREATE POLICY "Service role can manage all ACC tokens"
ON public.acc_oauth_tokens
FOR ALL
USING (true)
WITH CHECK (true);

-- Add updated_at trigger
CREATE TRIGGER update_acc_oauth_tokens_updated_at
BEFORE UPDATE ON public.acc_oauth_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
