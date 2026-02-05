-- Enable realtime for asset_sync_state to allow live progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_sync_state;