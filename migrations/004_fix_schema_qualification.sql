-- ============================================================================
-- FIX: Add explicit public schema qualification to all trigger functions
-- ============================================================================

-- Fix sync_identity_to_profile function
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

    -- Insert display_name attribute
    IF v_display_name IS NOT NULL AND v_display_name != '' THEN
        INSERT INTO public.profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'display_name', v_display_name, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert email attribute
    IF v_email IS NOT NULL AND v_email != '' THEN
        INSERT INTO public.profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'primary_email', v_email, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert username attribute
    IF v_username IS NOT NULL AND v_username != '' THEN
        INSERT INTO public.profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'username', v_username, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
        DO UPDATE SET
            attribute_value = EXCLUDED.attribute_value,
            updated_at = NOW();
    END IF;

    -- Insert avatar attribute
    IF v_avatar IS NOT NULL AND v_avatar != '' THEN
        INSERT INTO public.profile_attributes (profile_id, attribute_key, attribute_value, source_provider, is_preferred)
        VALUES (v_profile_id, 'avatar_url', v_avatar, NEW.provider, FALSE)
        ON CONFLICT (profile_id, attribute_key, source_provider)
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

-- Fix set_preferred_attribute function
CREATE OR REPLACE FUNCTION set_preferred_attribute(attr_id UUID)
RETURNS void AS $$
DECLARE
    v_profile_id UUID;
    v_attribute_key TEXT;
BEGIN
    -- Get profile_id and attribute_key for the given attribute
    SELECT profile_id, attribute_key
    INTO v_profile_id, v_attribute_key
    FROM public.profile_attributes
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
    UPDATE public.profile_attributes
    SET is_preferred = FALSE
    WHERE profile_id = v_profile_id
      AND attribute_key = v_attribute_key;

    -- Set this one as preferred
    UPDATE public.profile_attributes
    SET is_preferred = TRUE
    WHERE id = attr_id;

    -- Sync to profile
    UPDATE public.profiles
    SET
        display_name = CASE
            WHEN v_attribute_key = 'display_name' THEN
                (SELECT attribute_value FROM public.profile_attributes WHERE id = attr_id)
            ELSE display_name
        END,
        primary_email = CASE
            WHEN v_attribute_key = 'primary_email' THEN
                (SELECT attribute_value FROM public.profile_attributes WHERE id = attr_id)
            ELSE primary_email
        END
    WHERE id = v_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
