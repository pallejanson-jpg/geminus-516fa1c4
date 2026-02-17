ALTER TABLE public.room_label_configs ADD COLUMN occlusion_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.room_label_configs ADD COLUMN flat_on_floor BOOLEAN NOT NULL DEFAULT false;