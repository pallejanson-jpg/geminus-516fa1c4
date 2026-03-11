UPDATE public.conversion_jobs 
SET status = 'failed', 
    error_message = 'Auto-cleaned: stuck job', 
    updated_at = now() 
WHERE status IN ('pending', 'processing') 
  AND updated_at < now() - interval '1 hour';