-- ========================================
-- SECURITY OVERHAUL: Authentication & RBAC
-- ========================================

-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. Create profiles table (basic profile info)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 3. Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- 4. Enable RLS on both tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 5. Security definer function to check if user has a role (prevents recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 6. Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;

-- 7. Profiles RLS policies
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 8. User roles RLS policies (only admins can manage roles)
CREATE POLICY "Users can view own roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE
TO authenticated
USING (public.is_admin());

-- 9. Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  
  -- Create default role (first user gets admin, rest get user)
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  
  RETURN NEW;
END;
$$;

-- 10. Trigger for auto-profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. Update timestamp trigger for profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- UPDATE EXISTING RLS POLICIES FOR AUTH
-- ========================================

-- 12. Drop old permissive policies on assets
DROP POLICY IF EXISTS "Public read access to assets" ON public.assets;
DROP POLICY IF EXISTS "Service role can insert assets" ON public.assets;
DROP POLICY IF EXISTS "Service role can update assets" ON public.assets;

-- 13. New auth-required policies for assets
CREATE POLICY "Authenticated users can read assets"
ON public.assets FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert assets"
ON public.assets FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update assets"
ON public.assets FOR UPDATE
TO authenticated
USING (true);

-- 14. Update building_settings policies
DROP POLICY IF EXISTS "Public read access to building settings" ON public.building_settings;
DROP POLICY IF EXISTS "Public insert access to building settings" ON public.building_settings;
DROP POLICY IF EXISTS "Public update access to building settings" ON public.building_settings;

CREATE POLICY "Authenticated users can read building settings"
ON public.building_settings FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert building settings"
ON public.building_settings FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update building settings"
ON public.building_settings FOR UPDATE
TO authenticated
USING (true);

-- 15. Update annotation_symbols policies
DROP POLICY IF EXISTS "Public read access to annotation symbols" ON public.annotation_symbols;
DROP POLICY IF EXISTS "Public insert access to annotation symbols" ON public.annotation_symbols;
DROP POLICY IF EXISTS "Public update access to annotation symbols" ON public.annotation_symbols;
DROP POLICY IF EXISTS "Public delete access to annotation symbols" ON public.annotation_symbols;

CREATE POLICY "Authenticated users can read annotation symbols"
ON public.annotation_symbols FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert annotation symbols"
ON public.annotation_symbols FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update annotation symbols"
ON public.annotation_symbols FOR UPDATE
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can delete annotation symbols"
ON public.annotation_symbols FOR DELETE
TO authenticated
USING (public.is_admin());

-- 16. Update sync state policies (admin only)
DROP POLICY IF EXISTS "Public read access to sync state" ON public.asset_sync_state;

CREATE POLICY "Admins can read sync state"
ON public.asset_sync_state FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "Public read access to faciliate_sync_state" ON public.faciliate_sync_state;

CREATE POLICY "Admins can read faciliate sync state"
ON public.faciliate_sync_state FOR SELECT
TO authenticated
USING (public.is_admin());

-- 17. Update saved_views policies
DROP POLICY IF EXISTS "Public read access to saved_views" ON public.saved_views;
DROP POLICY IF EXISTS "Public insert access to saved_views" ON public.saved_views;
DROP POLICY IF EXISTS "Public update access to saved_views" ON public.saved_views;
DROP POLICY IF EXISTS "Public delete access to saved_views" ON public.saved_views;

CREATE POLICY "Authenticated users can read saved views"
ON public.saved_views FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert saved views"
ON public.saved_views FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update saved views"
ON public.saved_views FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete saved views"
ON public.saved_views FOR DELETE
TO authenticated
USING (true);

-- 18. Update viewer_themes policies
DROP POLICY IF EXISTS "Public read access to viewer themes" ON public.viewer_themes;
DROP POLICY IF EXISTS "Public insert access to viewer themes" ON public.viewer_themes;
DROP POLICY IF EXISTS "Public update access to viewer themes" ON public.viewer_themes;
DROP POLICY IF EXISTS "Public delete access to viewer themes" ON public.viewer_themes;

CREATE POLICY "Authenticated users can read viewer themes"
ON public.viewer_themes FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert viewer themes"
ON public.viewer_themes FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update viewer themes"
ON public.viewer_themes FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete non-system themes"
ON public.viewer_themes FOR DELETE
TO authenticated
USING (is_system = false);

-- 19. Update work_orders policies
DROP POLICY IF EXISTS "Public read access to work_orders" ON public.work_orders;
DROP POLICY IF EXISTS "Service role can insert work_orders" ON public.work_orders;
DROP POLICY IF EXISTS "Service role can update work_orders" ON public.work_orders;

CREATE POLICY "Authenticated users can read work orders"
ON public.work_orders FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert work orders"
ON public.work_orders FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update work orders"
ON public.work_orders FOR UPDATE
TO authenticated
USING (true);

-- 20. Update xkt_models policies
DROP POLICY IF EXISTS "Public read access to xkt_models" ON public.xkt_models;
DROP POLICY IF EXISTS "Service role can insert xkt_models" ON public.xkt_models;
DROP POLICY IF EXISTS "Service role can update xkt_models" ON public.xkt_models;

CREATE POLICY "Authenticated users can read xkt models"
ON public.xkt_models FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert xkt models"
ON public.xkt_models FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update xkt models"
ON public.xkt_models FOR UPDATE
TO authenticated
USING (true);

-- ========================================
-- UPDATE STORAGE POLICIES
-- ========================================

-- 21. Update symbol-icons bucket policies
DROP POLICY IF EXISTS "Anyone can upload symbol icons" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update symbol icons" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete symbol icons" ON storage.objects;

CREATE POLICY "Authenticated users can upload symbol icons"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'symbol-icons');

CREATE POLICY "Authenticated users can update symbol icons"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'symbol-icons');

CREATE POLICY "Admins can delete symbol icons"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'symbol-icons' AND public.is_admin());

-- 22. Update inventory-images bucket policies
DROP POLICY IF EXISTS "Anyone can upload inventory images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update inventory images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete inventory images" ON storage.objects;

CREATE POLICY "Authenticated users can upload inventory images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inventory-images');

CREATE POLICY "Authenticated users can update inventory images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'inventory-images');

CREATE POLICY "Authenticated users can delete inventory images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'inventory-images');

-- 23. Update saved-view-screenshots bucket policies
DROP POLICY IF EXISTS "Public insert access to view screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Public delete access to view screenshots" ON storage.objects;

CREATE POLICY "Authenticated users can upload view screenshots"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'saved-view-screenshots');

CREATE POLICY "Authenticated users can delete view screenshots"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'saved-view-screenshots');