ALTER TABLE conversion_jobs ADD COLUMN source_type text NOT NULL DEFAULT 'ifc';
ALTER TABLE conversion_jobs ADD COLUMN source_bucket text NOT NULL DEFAULT 'ifc-uploads';