ALTER TABLE xkt_models ADD COLUMN IF NOT EXISTS parent_model_id text;
ALTER TABLE xkt_models ADD COLUMN IF NOT EXISTS storey_fm_guid text;
ALTER TABLE xkt_models ADD COLUMN IF NOT EXISTS is_chunk boolean DEFAULT false;
ALTER TABLE xkt_models ADD COLUMN IF NOT EXISTS chunk_order integer DEFAULT 0;