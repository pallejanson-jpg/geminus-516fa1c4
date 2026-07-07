-- Increase xkt-models bucket file size limit from 100MB to 500MB
-- Large architectural BIM models (e.g. Småviken) exceed 100MB
UPDATE storage.buckets
SET file_size_limit = 524288000  -- 500 MB
WHERE id = 'xkt-models';
