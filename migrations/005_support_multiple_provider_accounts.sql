-- ============================================================================
-- Support multiple accounts from the same provider
-- Add identity_id to profile_attributes to distinguish between accounts
-- ============================================================================

-- Add identity_id column to profile_attributes
ALTER TABLE public.profile_attributes
ADD COLUMN identity_id UUID REFERENCES auth.identities(id) ON DELETE CASCADE;

-- Drop old constraint (profile_id, attribute_key, source_provider)
DROP INDEX IF EXISTS idx_profile_attributes_profile_key_provider;

-- Create new constraint (identity_id, attribute_key)
-- This allows multiple Google accounts with their own attributes
CREATE UNIQUE INDEX idx_profile_attributes_identity_key
    ON public.profile_attributes(identity_id, attribute_key)
    WHERE identity_id IS NOT NULL;

-- Keep the old constraint for backward compatibility (NULL identity_id)
CREATE UNIQUE INDEX idx_profile_attributes_profile_key_provider_legacy
    ON public.profile_attributes(profile_id, attribute_key, source_provider)
    WHERE identity_id IS NULL;

-- Update the preferred attribute constraint to work across all identities
DROP INDEX IF EXISTS idx_profile_attributes_preferred;
CREATE UNIQUE INDEX idx_profile_attributes_preferred
    ON public.profile_attributes(profile_id, attribute_key)
    WHERE is_preferred = TRUE;

-- Update sync_identity_to_profile to use identity_id
CREATE OR REPLACE FUNCTION sync_identity_to_profile()
RETURNS TRIGGER AS $$
DECLARE
    v_profile_id UUID;
    v_display_name TEXT;
    v_email TEXT;
    v_username TEXT;
    v_avatar TEXT;
    v_user_exists BOOLEAN;
BEGIN
    -- Ensure public.users record exists
    SELECT EXISTS(SELECT 1 FROM public.users WHERE id = NEW.user_id) INTO v_user_exists;

    IF NOT v_user_exists THEN
        INSERT INTO public.users (id) VALUES (NEW.user_id);
    END IF;

    -- Get profile_id for this user
    SELECT profile_id INTO v_profile_id
    FROM public.users
    WHERE id = NEW.user_id;

    -- If no profile exists, create one
    IF v_profile_id IS NULL THEN
        v_email := NEW.identity_data->>'email';
        v_display_name := COALESCE(
            NEW.identity_data->>'full_name',
            NEW.identity_data->>'name',
            NEW.identity_data->>'display_name'
        );

        INSERT INTO public.profiles (display_name, primary_email)
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

    -- Insert display_name attribute with identity_id
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        INSERT INTO public.profile_attributes (profile_id, identity_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, NEW.id, 'display_name', v_display_name, NEW.provider, FALSE)
        ON CONFLICT (identity_id, attribute_key) WHERE identity_id IS NOT NULL
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert email attribute with identity_id
    IF v_email IS NOT NULL AND v_email != '' THEN
        INSERT INTO public.profile_attributes (profile_id, identity_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, NEW.id, 'primary_email', v_email, NEW.provider, FALSE)
        ON CONFLICT (identity_id, attribute_key) WHERE identity_id IS NOT NULL
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert username attribute with identity_id
    IF v_username IS NOT NULL AND v_username != '' THEN
        INSERT INTO public.profile_attributes (profile_id, identity_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, NEW.id, 'username', v_username, NEW.provider, FALSE)
        ON CONFLICT (identity_id, attribute_key) WHERE identity_id IS NOT NULL
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert avatar attribute with identity_id
    IF v_avatar IS NOT NULL AND v_avatar != '' THEN
        INSERT INTO public.profile_attributes (profile_id, identity_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, NEW.id, 'avatar_url', v_avatar, NEW.provider, FALSE)
        ON CONFLICT (identity_id, attribute_key) WHERE identity_id IS NOT NULL
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Set first attribute of each key as preferred if none exists
    UPDATE public.profile_attributes pa1
    SET is_preferred = TRUE
    WHERE pa1.profile_id = v_profile_id
      AND pa1.id IN (
          SELECT DISTINCT ON (attribute_key) id
          FROM public.profile_attributes
          WHERE profile_id = v_profile_id
            AND attribute_key IN ('display_name', 'primary_email', 'username', 'avatar_url')
            AND NOT EXISTS (
                SELECT 1 FROM public.profile_attributes pa2
                WHERE pa2.profile_id = v_profile_id
                  AND pa2.attribute_key = public.profile_attributes.attribute_key
                  AND pa2.is_preferred = TRUE
            )
          ORDER BY attribute_key, created_at ASC
      );

    -- Sync profile aggregate
    UPDATE public.profiles
    SET
        display_name = COALESCE(
            (SELECT attribute_value FROM public.profile_attributes
             WHERE profile_id = v_profile_id
               AND attribute_key = 'display_name'
               AND is_preferred = TRUE
             LIMIT 1),
            display_name
        ),
        primary_email = COALESCE(
            (SELECT attribute_value FROM public.profile_attributes
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
