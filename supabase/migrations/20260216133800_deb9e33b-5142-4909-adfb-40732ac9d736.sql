-- Add source_updated_at column to xkt_models for cache staleness validation
ALTER TABLE public.xkt_models 
ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;

-- Add DELETE policy so stale models can be removed (manual cache invalidation)
CREATE POLICY "Authenticated users can delete xkt models"
ON public.xkt_models
FOR DELETE
USING (true);