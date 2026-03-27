-- Delete duplicate xkt_models for SV building, keeping only latest ARK and RIV
DELETE FROM xkt_models 
WHERE building_fm_guid = '27560283-3300-4635-b0a7-a1924a2aed6a'
  AND model_id NOT IN ('ifc-1774611887499', 'ifc-1774617999007');

-- Delete all misclassified spaces (5067 → will be re-created correctly on next import)
DELETE FROM assets 
WHERE building_fm_guid = '27560283-3300-4635-b0a7-a1924a2aed6a'
  AND category = 'Space';

-- Delete instances too (will be re-created with proper categories)
DELETE FROM assets 
WHERE building_fm_guid = '27560283-3300-4635-b0a7-a1924a2aed6a'
  AND category = 'Instance';

-- Delete stale geometry_entity_map entries for this building
DELETE FROM geometry_entity_map
WHERE building_fm_guid = '27560283-3300-4635-b0a7-a1924a2aed6a';