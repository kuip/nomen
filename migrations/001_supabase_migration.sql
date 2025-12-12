-- ============================================================================
-- NOMEN SUPABASE MIGRATION
-- Complete database schema with Supabase auth integration
-- ============================================================================

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(255),
    primary_email VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create profile_attributes table
CREATE TABLE IF NOT EXISTS profile_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    attribute_key VARCHAR(100) NOT NULL,
    attribute_value TEXT,
    source_provider VARCHAR(50),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create users table that references auth.users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_profile_attributes_profile_id ON profile_attributes(profile_id);
CREATE INDEX IF NOT EXISTS idx_users_profile_id ON public.users(profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_attributes_profile_key_provider
    ON profile_attributes(profile_id, attribute_key, source_provider);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_attributes_preferred
    ON profile_attributes(profile_id, attribute_key)
    WHERE is_preferred = TRUE;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profile_attributes_updated_at BEFORE UPDATE ON profile_attributes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PROFILE PROVIDERS VIEW
-- Simple view over auth.identities - no sensitive data duplication
-- Only shows providers for the authenticated user
-- ============================================================================

CREATE VIEW profile_providers WITH (security_barrier = true) AS
SELECT
    i.provider,
    u.profile_id,
    i.created_at as verified_at
FROM auth.identities i
JOIN public.users u ON u.id = i.user_id
WHERE u.profile_id IS NOT NULL
  AND u.id = auth.uid();

-- ============================================================================
-- SUPABASE AUTH INTEGRATION
-- ============================================================================

-- Function to create user record on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();

-- Function to sync auth.identities to profile and profile_attributes
CREATE OR REPLACE FUNCTION sync_identity_to_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_profile_id UUID;
    v_display_name TEXT;
    v_email TEXT;
    v_username TEXT;
    v_avatar TEXT;
BEGIN
    -- Get profile_id for this user
    SELECT profile_id INTO v_profile_id
    FROM public.users
    WHERE id = NEW.user_id;

    -- If no profile exists, create one
    IF v_profile_id IS NULL THEN
        -- Extract email from identity_data
        v_email := NEW.identity_data->>'email';
        v_display_name := COALESCE(
            NEW.identity_data->>'full_name',
            NEW.identity_data->>'name',
            NEW.identity_data->>'display_name'
        );

        INSERT INTO profiles (display_name, primary_email)
        VALUES (v_display_name, v_email)
        RETURNING id INTO v_profile_id;

        -- Link profile to user
        UPDATE public.users
        SET profile_id = v_profile_id
        WHERE id = NEW.user_id;
    END IF;

    -- Extract profile attributes
    v_display_name := COALESCE(
        NEW.identity_data->>'full_name',
        NEW.identity_data->>'name',
        NEW.identity_data->>'display_name'
    );
    v_email := NEW.identity_data->>'email';
    v_username := COALESCE(
        NEW.identity_data->>'preferred_username',
        NEW.identity_data->>'user_name',
        NEW.identity_data->>'login'
    );
    v_avatar := COALESCE(
        NEW.identity_data->>'avatar_url',
        NEW.identity_data->>'picture'
    );

    -- Insert display_name attribute
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        INSERT INTO profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'display_name', v_display_name, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert email attribute
    IF v_email IS NOT NULL AND v_email != '' THEN
        INSERT INTO profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'primary_email', v_email, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert username attribute
    IF v_username IS NOT NULL AND v_username != '' THEN
        INSERT INTO profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'username', v_username, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert avatar attribute
    IF v_avatar IS NOT NULL AND v_avatar != '' THEN
        INSERT INTO profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'avatar_url', v_avatar, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Set first attribute of each key as preferred if none exists
    UPDATE profile_attributes pa1
    SET is_preferred = TRUE
    WHERE pa1.profile_id = v_profile_id
      AND pa1.id IN (
          SELECT DISTINCT ON (attribute_key) id
          FROM profile_attributes
          WHERE profile_id = v_profile_id
            AND attribute_key IN ('display_name', 'primary_email', 'username', 'avatar_url')
            AND NOT EXISTS (
                SELECT 1 FROM profile_attributes pa2
                WHERE pa2.profile_id = v_profile_id
                  AND pa2.attribute_key = profile_attributes.attribute_key
                  AND pa2.is_preferred = TRUE
            )
          ORDER BY attribute_key, created_at ASC
      );

    -- Sync profile aggregate
    UPDATE profiles
    SET
        display_name = COALESCE(
            (SELECT attribute_value FROM profile_attributes
             WHERE profile_id = v_profile_id
               AND attribute_key = 'display_name'
               AND is_preferred = TRUE
             LIMIT 1),
            display_name
        ),
        primary_email = COALESCE(
            (SELECT attribute_value FROM profile_attributes
             WHERE profile_id = v_profile_id
               AND attribute_key = 'primary_email'
               AND is_preferred = TRUE
             LIMIT 1),
            primary_email
        )
    WHERE id = v_profile_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.identities
CREATE TRIGGER on_identity_created
    AFTER INSERT ON auth.identities
    FOR EACH ROW
    EXECUTE FUNCTION sync_identity_to_profile();

CREATE TRIGGER on_identity_updated
    AFTER UPDATE ON auth.identities
    FOR EACH ROW
    EXECUTE FUNCTION sync_identity_to_profile();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view own record"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own record"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

-- RLS Policies for profiles table
CREATE POLICY "Users can view own profiles"
    ON profiles FOR SELECT
    USING (
        id IN (SELECT profile_id FROM public.users WHERE id = auth.uid())
    );

CREATE POLICY "Users can update own profiles"
    ON profiles FOR UPDATE
    USING (
        id IN (SELECT profile_id FROM public.users WHERE id = auth.uid())
    );

-- RLS Policies for profile_attributes
CREATE POLICY "Users can view own attributes"
    ON profile_attributes FOR SELECT
    USING (
        profile_id IN (SELECT profile_id FROM public.users WHERE id = auth.uid())
    );

CREATE POLICY "Users can update own attributes"
    ON profile_attributes FOR UPDATE
    USING (
        profile_id IN (SELECT profile_id FROM public.users WHERE id = auth.uid())
    );

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Function to set preferred attribute
CREATE OR REPLACE FUNCTION set_preferred_attribute(attr_id UUID)
RETURNS void AS $$
DECLARE
    v_profile_id UUID;
    v_attribute_key TEXT;
BEGIN
    -- Get profile_id and attribute_key for the given attribute
    SELECT profile_id, attribute_key
    INTO v_profile_id, v_attribute_key
    FROM profile_attributes
    WHERE id = attr_id;

    -- Verify user owns this profile
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
          AND profile_id = v_profile_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Unset all preferred for this key
    UPDATE profile_attributes
    SET is_preferred = FALSE
    WHERE profile_id = v_profile_id
      AND attribute_key = v_attribute_key;

    -- Set this one as preferred
    UPDATE profile_attributes
    SET is_preferred = TRUE
    WHERE id = attr_id;

    -- Sync to profile
    UPDATE profiles
    SET
        display_name = CASE
            WHEN v_attribute_key = 'display_name' THEN
                (SELECT attribute_value FROM profile_attributes WHERE id = attr_id)
            ELSE display_name
        END,
        primary_email = CASE
            WHEN v_attribute_key = 'primary_email' THEN
                (SELECT attribute_value FROM profile_attributes WHERE id = attr_id)
            ELSE primary_email
        END
    WHERE id = v_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
