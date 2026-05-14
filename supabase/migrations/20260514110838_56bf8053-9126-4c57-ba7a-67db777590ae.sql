UPDATE public.asset_sync_state
SET sync_status = 'failed',
    error_message = COALESCE(error_message, 'Marked failed: stale running/interrupted state cleared')
WHERE sync_status IN ('running', 'interrupted');