-- ============================================================================
-- FIX: Add RLS protection to profile_providers view
-- ============================================================================

-- Drop the existing view
DROP VIEW IF EXISTS profile_providers;

-- Recreate with security barrier and auth.uid() filter
CREATE VIEW profile_providers WITH (security_barrier = true) AS
SELECT
    i.provider,
    u.profile_id,
    i.created_at as verified_at
FROM auth.identities i
JOIN public.users u ON u.id = i.user_id
WHERE u.profile_id IS NOT NULL
  AND u.id = auth.uid();
