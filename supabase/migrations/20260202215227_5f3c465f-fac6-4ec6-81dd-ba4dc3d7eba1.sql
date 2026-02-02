-- Add columns for cursor-based pagination and error tracking
ALTER TABLE public.asset_sync_progress 
ADD COLUMN IF NOT EXISTS cursor_fm_guid text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS page_mode text DEFAULT 'skip',
ADD COLUMN IF NOT EXISTS last_error text DEFAULT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN public.asset_sync_progress.cursor_fm_guid IS 'Last fmGuid processed for cursor-based pagination (avoids high skip values)';
COMMENT ON COLUMN public.asset_sync_progress.page_mode IS 'Pagination mode: skip (default) or cursor';
COMMENT ON COLUMN public.asset_sync_progress.last_error IS 'Last error message for diagnostics';