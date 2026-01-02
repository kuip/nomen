-- ============================================================================
-- Account Merge Support
-- Add merged_user_ids tracking and helper functions for account merging
-- ============================================================================

-- Add merged_user_ids to profiles to track absorbed accounts
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS merged_user_ids UUID[] DEFAULT '{}';

-- Function to get the owner of an identity (for edge function to call)
-- Returns the user_id and profile info if the identity exists
CREATE OR REPLACE FUNCTION get_identity_owner(
    p_provider TEXT,
    p_provider_id TEXT
)
RETURNS TABLE (
    user_id UUID,
    profile_id UUID,
    display_name VARCHAR(255),
    primary_email VARCHAR(255)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.user_id,
        u.profile_id,
        p.display_name,
        p.primary_email
    FROM auth.identities i
    JOIN public.users u ON u.id = i.user_id
    LEFT JOIN public.profiles p ON p.id = u.profile_id
    WHERE i.provider = p_provider
      AND i.provider_id = p_provider_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to merge profiles (profile-level merge)
-- This merges source_user's profile into target_user's profile
-- Both auth.users remain, but point to the same profile
CREATE OR REPLACE FUNCTION merge_profiles(
    p_target_user_id UUID,
    p_source_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_target_profile_id UUID;
    v_source_profile_id UUID;
    v_source_user_id UUID;
    v_merged_count INT := 0;
BEGIN
    -- Get target profile
    SELECT profile_id INTO v_target_profile_id
    FROM public.users
    WHERE id = p_target_user_id;

    IF v_target_profile_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Target user has no profile');
    END IF;

    -- Get source profile
    SELECT profile_id INTO v_source_profile_id
    FROM public.users
    WHERE id = p_source_user_id;

    IF v_source_profile_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Source user has no profile');
    END IF;

    IF v_target_profile_id = v_source_profile_id THEN
        RETURN json_build_object('success', false, 'error', 'Users already share the same profile');
    END IF;

    -- Move all profile_attributes from source to target profile
    -- Update profile_id for attributes that don't conflict
    UPDATE public.profile_attributes
    SET profile_id = v_target_profile_id,
        is_preferred = FALSE,  -- Don't override target's preferences
        updated_at = NOW()
    WHERE profile_id = v_source_profile_id;

    GET DIAGNOSTICS v_merged_count = ROW_COUNT;

    -- Point source user to target profile
    UPDATE public.users
    SET profile_id = v_target_profile_id,
        updated_at = NOW()
    WHERE id = p_source_user_id;

    -- Add source user_id to merged_user_ids array
    UPDATE public.profiles
    SET merged_user_ids = array_append(
            COALESCE(merged_user_ids, '{}'),
            p_source_user_id
        ),
        updated_at = NOW()
    WHERE id = v_target_profile_id;

    -- Delete the now-orphaned source profile
    DELETE FROM public.profiles
    WHERE id = v_source_profile_id;

    RETURN json_build_object(
        'success', true,
        'target_profile_id', v_target_profile_id,
        'source_profile_deleted', v_source_profile_id,
        'attributes_merged', v_merged_count,
        'source_user_id', p_source_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if current user can initiate a merge with another account
-- This is called from client to check before calling edge function
CREATE OR REPLACE FUNCTION check_merge_candidate(
    p_provider TEXT,
    p_provider_id TEXT
)
RETURNS JSON AS $$
DECLARE
    v_current_user_id UUID;
    v_identity_owner_id UUID;
    v_identity_profile_id UUID;
    v_identity_display_name VARCHAR(255);
    v_identity_email VARCHAR(255);
BEGIN
    v_current_user_id := auth.uid();

    IF v_current_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Find the owner of this identity
    SELECT
        i.user_id,
        u.profile_id,
        p.display_name,
        p.primary_email
    INTO
        v_identity_owner_id,
        v_identity_profile_id,
        v_identity_display_name,
        v_identity_email
    FROM auth.identities i
    JOIN public.users u ON u.id = i.user_id
    LEFT JOIN public.profiles p ON p.id = u.profile_id
    WHERE i.provider = p_provider
      AND i.provider_id = p_provider_id;

    IF v_identity_owner_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Identity not found');
    END IF;

    IF v_identity_owner_id = v_current_user_id THEN
        RETURN json_build_object('success', false, 'error', 'Identity already belongs to you');
    END IF;

    -- Return info about the other account
    RETURN json_build_object(
        'success', true,
        'can_merge', true,
        'other_user_id', v_identity_owner_id,
        'other_profile_id', v_identity_profile_id,
        'other_display_name', v_identity_display_name,
        'other_email', v_identity_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_identity_owner TO service_role;
GRANT EXECUTE ON FUNCTION merge_profiles TO service_role;
GRANT EXECUTE ON FUNCTION check_merge_candidate TO authenticated;
