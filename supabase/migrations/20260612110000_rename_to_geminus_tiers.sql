-- Rename product-brand database objects to Geminus tier names:
--   FM Access -> Geminus Base
--   Senslinc  -> Geminus Premium
--   Asset+    -> Geminus Plus

-- ── Tables ──
ALTER TABLE public.fm_access_drawings RENAME TO geminus_base_drawings;
ALTER TABLE public.fm_access_documents RENAME TO geminus_base_documents;
ALTER TABLE public.fm_access_dou RENAME TO geminus_base_dou;
ALTER TABLE public.asset_plus_endpoint_cache RENAME TO geminus_plus_endpoint_cache;
ALTER TABLE public.acc_assetplus_guid_map RENAME TO acc_geminus_plus_guid_map;

-- ── Columns: acc_geminus_plus_guid_map ──
ALTER TABLE public.acc_geminus_plus_guid_map RENAME COLUMN assetplus_fm_guid TO geminus_plus_fm_guid;

-- ── Columns: building_settings ──
ALTER TABLE public.building_settings RENAME COLUMN fm_access_building_guid TO geminus_base_building_guid;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_api_url TO geminus_plus_api_url;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_api_key TO geminus_plus_api_key;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_keycloak_url TO geminus_plus_keycloak_url;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_client_id TO geminus_plus_client_id;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_client_secret TO geminus_plus_client_secret;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_username TO geminus_plus_username;
ALTER TABLE public.building_settings RENAME COLUMN assetplus_password TO geminus_plus_password;
ALTER TABLE public.building_settings RENAME COLUMN senslinc_api_url TO geminus_premium_api_url;
ALTER TABLE public.building_settings RENAME COLUMN senslinc_email TO geminus_premium_email;
ALTER TABLE public.building_settings RENAME COLUMN senslinc_password TO geminus_premium_password;

-- ── Columns: api_profiles ──
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_api_url TO geminus_plus_api_url;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_api_key TO geminus_plus_api_key;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_keycloak_url TO geminus_plus_keycloak_url;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_client_id TO geminus_plus_client_id;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_client_secret TO geminus_plus_client_secret;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_username TO geminus_plus_username;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_password TO geminus_plus_password;
ALTER TABLE public.api_profiles RENAME COLUMN assetplus_audience TO geminus_plus_audience;
ALTER TABLE public.api_profiles RENAME COLUMN senslinc_api_url TO geminus_premium_api_url;
ALTER TABLE public.api_profiles RENAME COLUMN senslinc_email TO geminus_premium_email;
ALTER TABLE public.api_profiles RENAME COLUMN senslinc_password TO geminus_premium_password;
ALTER TABLE public.api_profiles RENAME COLUMN fm_access_api_url TO geminus_base_api_url;
ALTER TABLE public.api_profiles RENAME COLUMN fm_access_username TO geminus_base_username;
ALTER TABLE public.api_profiles RENAME COLUMN fm_access_password TO geminus_base_password;

-- ── Data values & defaults ──
ALTER TABLE public.geometry_entity_map ALTER COLUMN source_system SET DEFAULT 'geminus_plus';
UPDATE public.geometry_entity_map SET source_system = 'geminus_plus' WHERE source_system = 'asset_plus';

UPDATE public.faciliate_sync_state SET sync_type = 'geminus_base_drawings' WHERE sync_type = 'fm_access_drawings';
UPDATE public.faciliate_sync_state SET sync_type = 'geminus_base_documents' WHERE sync_type = 'fm_access_documents';
UPDATE public.faciliate_sync_state SET sync_type = 'geminus_base_dou' WHERE sync_type = 'fm_access_dou';
