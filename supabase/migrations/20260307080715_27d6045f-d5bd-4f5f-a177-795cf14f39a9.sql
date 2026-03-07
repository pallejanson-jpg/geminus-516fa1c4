-- Feedback threads
CREATE TABLE public.feedback_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'suggestion',
  status text NOT NULL DEFAULT 'open',
  vote_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feedback threads" ON public.feedback_threads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create own feedback threads" ON public.feedback_threads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own feedback threads" ON public.feedback_threads FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can update all feedback threads" ON public.feedback_threads FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "Admins can delete feedback threads" ON public.feedback_threads FOR DELETE TO authenticated USING (public.is_admin());

-- Feedback comments
CREATE TABLE public.feedback_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.feedback_threads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feedback comments" ON public.feedback_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create own feedback comments" ON public.feedback_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can delete feedback comments" ON public.feedback_comments FOR DELETE TO authenticated USING (public.is_admin());

-- Feedback votes
CREATE TABLE public.feedback_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.feedback_threads(id) ON DELETE CASCADE NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id, user_id)
);

ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read feedback votes" ON public.feedback_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create own feedback votes" ON public.feedback_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own feedback votes" ON public.feedback_votes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger for updated_at on feedback_threads
CREATE TRIGGER update_feedback_threads_updated_at
  BEFORE UPDATE ON public.feedback_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();