-- Add symbol_id column for numeric symbol identification
ALTER TABLE annotation_symbols 
ADD COLUMN symbol_id INTEGER UNIQUE;

-- Update existing symbols with symbol_id 1-99 (reserved range)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) as rn
  FROM annotation_symbols
)
UPDATE annotation_symbols 
SET symbol_id = numbered.rn
FROM numbered
WHERE annotation_symbols.id = numbered.id;