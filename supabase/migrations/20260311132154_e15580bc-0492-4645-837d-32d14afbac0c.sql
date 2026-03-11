UPDATE public.conversion_jobs 
SET status = 'failed', error_message = 'Auto-cleaned: stuck job', updated_at = now() 
WHERE id = '8aa4a53c-9df2-4231-a103-e9e2d202263f';