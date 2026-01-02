-- ============================================================================
-- Account Merge Support
-- Add merged_user_ids tracking and helper functions for account merging
-- ============================================================================

-- Add merged_user_ids to profiles to track absorbed accounts
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS merged_user_ids UUID[] DEFAULT '{}';

-- Table to store pending merge requests (secure, RLS-protected)
CREATE TABLE IF NOT EXISTS public.pending_merges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    UNIQUE(token)
);

-- RLS for pending_merges
ALTER TABLE public.pending_merges ENABLE ROW LEVEL SECURITY;

-- Users can only create merge requests for themselves
CREATE POLICY "Users can create own merge requests"
    ON public.pending_merges FOR INSERT
    WITH CHECK (requester_id = auth.uid());

-- Anyone can read by token (needed after OAuth when session changed)
-- But tokens are random UUIDs, so this is secure
CREATE POLICY "Anyone can read by token"
    ON public.pending_merges FOR SELECT
    USING (true);

-- Users can delete their own requests
CREATE POLICY "Users can delete own merge requests"
    ON public.pending_merges FOR DELETE
    USING (requester_id = auth.uid());

-- Function to create a merge request (returns token)
CREATE OR REPLACE FUNCTION create_merge_request()
RETURNS JSON AS $$
DECLARE
    v_token UUID;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Delete any existing pending requests from this user
    DELETE FROM public.pending_merges WHERE requester_id = v_user_id;

    -- Create new request
    INSERT INTO public.pending_merges (requester_id)
    VALUES (v_user_id)
    RETURNING token INTO v_token;

    RETURN json_build_object('success', true, 'token', v_token);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get info about who initiated a merge request (for confirmation dialog)
CREATE OR REPLACE FUNCTION get_merge_requester_info(p_token UUID)
RETURNS JSON AS $$
DECLARE
    v_requester_id UUID;
    v_current_user_id UUID;
    v_display_name VARCHAR(255);
    v_email VARCHAR(255);
BEGIN
    v_current_user_id := auth.uid();

    IF v_current_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Look up the merge request by token
    SELECT requester_id INTO v_requester_id
    FROM public.pending_merges
    WHERE token = p_token
      AND expires_at > NOW();

    IF v_requester_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid or expired merge token');
    END IF;

    -- If same user, this is the requester returning to their own account
    IF v_requester_id = v_current_user_id THEN
        RETURN json_build_object('success', false, 'error', 'same_user');
    END IF;

    -- Get requester's profile info
    SELECT p.display_name, p.primary_email
    INTO v_display_name, v_email
    FROM public.users u
    LEFT JOIN public.profiles p ON p.id = u.profile_id
    WHERE u.id = v_requester_id;

    RETURN json_build_object(
        'success', true,
        'requester_id', v_requester_id,
        'requester_display_name', v_display_name,
        'requester_email', v_email
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cancel/reject a merge request
CREATE OR REPLACE FUNCTION cancel_merge_request(p_token UUID)
RETURNS JSON AS $$
BEGIN
    -- Delete the pending merge request by token
    -- Anyone with the token can cancel (either requester or target)
    DELETE FROM public.pending_merges
    WHERE token = p_token;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to execute merge using token (called after OAuth and confirmation)
CREATE OR REPLACE FUNCTION execute_merge_with_token(p_token UUID)
RETURNS JSON AS $$
DECLARE
    v_requester_id UUID;
    v_current_user_id UUID;
    v_merge_result JSON;
BEGIN
    v_current_user_id := auth.uid();

    IF v_current_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    -- Look up the merge request by token
    SELECT requester_id INTO v_requester_id
    FROM public.pending_merges
    WHERE token = p_token
      AND expires_at > NOW();

    IF v_requester_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid or expired merge token');
    END IF;

    -- Delete the pending merge request
    DELETE FROM public.pending_merges WHERE token = p_token;

    -- If same user, nothing to merge
    IF v_requester_id = v_current_user_id THEN
        RETURN json_build_object('success', false, 'error', 'Cannot merge account with itself. This provider is already linked to your account.');
    END IF;

    -- Execute the merge: current user (source) INTO requester (target)
    -- Note: we call the internal merge logic here directly
    SELECT merge_profiles_internal(v_requester_id, v_current_user_id) INTO v_merge_result;

    RETURN v_merge_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

-- Internal function to merge accounts (TRUE merge)
-- Called by execute_merge_with_token after authorization is verified
-- Moves all identities from source_user to target_user
-- Deletes the source auth.user completely
CREATE OR REPLACE FUNCTION merge_profiles_internal(
    p_target_user_id UUID,
    p_source_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_target_profile_id UUID;
    v_source_profile_id UUID;
    v_merged_count INT := 0;
    v_identities_moved INT := 0;
BEGIN
    -- Validate users are different
    IF p_target_user_id = p_source_user_id THEN
        RETURN json_build_object('success', false, 'error', 'Cannot merge user with itself');
    END IF;

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

    -- 1. Move all identities from source to target user
    UPDATE auth.identities
    SET user_id = p_target_user_id,
        updated_at = NOW()
    WHERE user_id = p_source_user_id;

    GET DIAGNOSTICS v_identities_moved = ROW_COUNT;

    -- 2. Move all profile_attributes from source to target profile
    UPDATE public.profile_attributes
    SET profile_id = v_target_profile_id,
        is_preferred = FALSE,  -- Don't override target's preferences
        updated_at = NOW()
    WHERE profile_id = v_source_profile_id;

    GET DIAGNOSTICS v_merged_count = ROW_COUNT;

    -- 3. Add source user_id to merged_user_ids array (for reference)
    UPDATE public.profiles
    SET merged_user_ids = array_append(
            COALESCE(merged_user_ids, '{}'),
            p_source_user_id
        ),
        updated_at = NOW()
    WHERE id = v_target_profile_id;

    -- 4. Delete the source profile
    DELETE FROM public.profiles
    WHERE id = v_source_profile_id;

    -- 5. Delete the source public.users record
    DELETE FROM public.users
    WHERE id = p_source_user_id;

    -- 6. Delete the source auth.user (cascades sessions, etc.)
    DELETE FROM auth.users
    WHERE id = p_source_user_id;

    RETURN json_build_object(
        'success', true,
        'target_profile_id', v_target_profile_id,
        'source_profile_deleted', v_source_profile_id,
        'attributes_merged', v_merged_count,
        'identities_moved', v_identities_moved,
        'source_user_deleted', p_source_user_id
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
GRANT EXECUTE ON FUNCTION create_merge_request TO authenticated;
GRANT EXECUTE ON FUNCTION get_merge_requester_info TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_merge_request TO authenticated;
GRANT EXECUTE ON FUNCTION execute_merge_with_token TO authenticated;
GRANT EXECUTE ON FUNCTION get_identity_owner TO service_role;
GRANT EXECUTE ON FUNCTION merge_profiles_internal TO service_role;  -- Only called internally
GRANT EXECUTE ON FUNCTION check_merge_candidate TO authenticated;

-- Clean up expired merge requests periodically (optional - can be done via cron)
-- DELETE FROM public.pending_merges WHERE expires_at < NOW();
