import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

interface Profile {
  id: string
  display_name: string | null
  primary_email: string | null
  created_at: string
  merged_user_ids?: string[]
}

interface User {
  id: string
  profile_id: string | null
  created_at: string
  updated_at: string
}

interface ProfileAttribute {
  id: string
  attribute_key: string
  attribute_value: string
  source_provider: string | null
  identity_id: string | null
  is_preferred: boolean
  updated_at: string
}

type ProviderId = 'google' | 'github' | 'linkedin_oidc' | 'facebook' | 'discord' | 'twitter'

const providerOptions: Array<{ id: ProviderId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
  { id: 'linkedin_oidc', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'discord', label: 'Discord' },
  { id: 'twitter', label: 'Twitter' },
]

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [attributes, setAttributes] = useState<ProfileAttribute[]>([])
  const [loading, setLoading] = useState(true)
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({})
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [showMergeProviders, setShowMergeProviders] = useState(false)
  const [pendingMergeToken, setPendingMergeToken] = useState<string | null>(null)
  const [mergeRequesterInfo, setMergeRequesterInfo] = useState<{ display_name: string | null; email: string | null } | null>(null)
  const [mergeEmail, setMergeEmail] = useState('')
  const [mergePassword, setMergePassword] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()

      // Handle invalid/expired refresh token
      if (error) {
        console.error('Session error:', error)
        await supabase.auth.signOut()
        navigate('/auth')
        return
      }

      if (!session) {
        navigate('/auth')
        return
      }

      // Check if we're returning from a merge OAuth flow
      const mergeToken = sessionStorage.getItem('merge_token')

      if (mergeToken) {
        // Don't clear token yet - we need it for confirmation
        // Look up who initiated this merge request
        try {
          const { data, error } = await supabase.rpc('get_merge_requester_info', {
            p_token: mergeToken,
          })

          if (error || !data?.success) {
            // Invalid or expired token
            sessionStorage.removeItem('merge_token')
            if (data?.error === 'same_user') {
              setMergeError('This provider is already linked to your account.')
            } else {
              setMergeError(data?.error || 'Invalid or expired merge request.')
            }
          } else {
            // Show confirmation dialog with requester info
            setPendingMergeToken(mergeToken)
            setMergeRequesterInfo({
              display_name: data.requester_display_name,
              email: data.requester_email,
            })
          }
        } catch (err) {
          console.error('Error checking merge request:', err)
          sessionStorage.removeItem('merge_token')
          setMergeError('Failed to verify merge request')
        }
      }

      setSession(session)
      await loadUserData(session.user.id)
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        navigate('/auth')
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  async function loadUserData(userId: string) {
    try {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()

      if (userError) throw userError
      setUser(userData)

      if (userData.profile_id) {
        await Promise.all([
          loadProfiles(userData.profile_id),
          loadAttributes(userData.profile_id),
          loadProviderCounts(userData.profile_id),
        ])
      }
    } catch (err) {
      console.error('Error loading user data:', err)
    } finally {
      setLoading(false)
    }
  }

  async function loadProfiles(profileId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profileId)

    if (!error && data) {
      setProfiles(data)
    }
  }

  async function loadAttributes(profileId: string) {
    const { data, error } = await supabase
      .from('profile_attributes')
      .select('*')
      .eq('profile_id', profileId)
      .order('attribute_key', { ascending: true })

    if (!error && data) {
      setAttributes(data)
    }
  }

  async function loadProviderCounts(profileId: string) {
    const { data, error } = await supabase
      .from('profile_providers')
      .select('provider')
      .eq('profile_id', profileId)

    if (!error && data) {
      const counts = data.reduce<Record<string, number>>((acc, item) => {
        const key = item.provider || 'unknown'
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
      setLinkCounts(counts)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/auth')
  }

  async function handleSetPreferred(attributeId: string) {
    const { error } = await supabase.rpc('set_preferred_attribute', {
      attr_id: attributeId
    })

    if (!error && user?.profile_id) {
      await Promise.all([
        loadProfiles(user.profile_id),
        loadAttributes(user.profile_id)
      ])
    }
  }

  async function startLinkFlow(provider: ProviderId) {
    if (!user?.profile_id) return

    try {
      // Use Supabase's linkIdentity - links to current user, no session switch!
      const { error } = await supabase.auth.linkIdentity({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        }
      })

      if (error) {
        console.error('Failed to link identity:', error)
        // Check if this is an "identity already exists" error
        if (error.message?.toLowerCase().includes('identity') ||
            error.code === 'identity_already_exists' ||
            error.message?.toLowerCase().includes('already')) {
          setMergeError('This provider is linked to another account. Use "Merge Another Account" to combine accounts.')
        }
      }
    } catch (err) {
      console.error('Failed to start link flow:', err)
    }
  }

  // Confirm and execute the merge
  async function confirmMerge() {
    if (!pendingMergeToken) return

    setMergeLoading(true)
    setMergeError(null)

    try {
      const { data, error } = await supabase.rpc('execute_merge_with_token', {
        p_token: pendingMergeToken,
      })

      // Clear token from storage regardless of outcome
      sessionStorage.removeItem('merge_token')
      setPendingMergeToken(null)
      setMergeRequesterInfo(null)

      if (error) {
        console.error('Merge error:', error)
        setMergeError(error.message || 'Failed to merge accounts')
      } else if (data && !data.success) {
        setMergeError(data.error || 'Failed to merge accounts')
      } else if (data?.success) {
        // Merge successful! Current user was merged into the original requester.
        // Current session is now invalid, need to sign out and sign back in.
        alert('Accounts merged successfully! Please sign in again with any of your linked providers.')
        await supabase.auth.signOut()
        navigate('/auth')
        return
      }
    } catch (err) {
      console.error('Merge error:', err)
      setMergeError('An unexpected error occurred during merge')
    } finally {
      setMergeLoading(false)
    }
  }

  // Reject the merge request
  async function rejectMerge() {
    if (!pendingMergeToken) return

    setMergeLoading(true)

    try {
      // Delete the pending merge from database
      await supabase.rpc('cancel_merge_request', {
        p_token: pendingMergeToken,
      })
    } catch (err) {
      console.error('Error cancelling merge:', err)
    } finally {
      // Clear token from storage
      sessionStorage.removeItem('merge_token')
      setPendingMergeToken(null)
      setMergeRequesterInfo(null)
      setMergeLoading(false)
    }
  }

  // Start the secure merge flow
  async function startMergeFlow(provider: ProviderId) {
    try {
      setMergeLoading(true)
      setMergeError(null)

      // 1. Create a merge request in the database (returns secure token)
      const { data, error } = await supabase.rpc('create_merge_request')

      if (error || !data?.success) {
        setMergeError(error?.message || data?.error || 'Failed to create merge request')
        return
      }

      const token = data.token

      // 2. Store only the token in sessionStorage (NOT the user ID)
      sessionStorage.setItem('merge_token', token)

      // 3. Sign in with OAuth (this will change the session if identity belongs to another user)
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        }
      })

      if (oauthError) {
        sessionStorage.removeItem('merge_token')
        setMergeError(oauthError.message || 'Failed to start OAuth')
      }
    } catch (err) {
      console.error('Failed to start merge flow:', err)
      sessionStorage.removeItem('merge_token')
      setMergeError('An unexpected error occurred')
    } finally {
      setMergeLoading(false)
    }
  }

  // Start merge flow with email/password
  async function startMergeWithEmail(e: React.FormEvent) {
    e.preventDefault()

    try {
      setMergeLoading(true)
      setMergeError(null)

      // 1. Create a merge request in the database (returns secure token)
      const { data, error } = await supabase.rpc('create_merge_request')

      if (error || !data?.success) {
        setMergeError(error?.message || data?.error || 'Failed to create merge request')
        return
      }

      const token = data.token

      // 2. Store only the token in sessionStorage
      sessionStorage.setItem('merge_token', token)

      // 3. Sign in with email/password (this will change the session)
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: mergeEmail,
        password: mergePassword,
      })

      if (signInError) {
        sessionStorage.removeItem('merge_token')
        setMergeError(signInError.message || 'Failed to sign in')
        return
      }

      // Clear form
      setMergeEmail('')
      setMergePassword('')

      // Session changed - the useEffect will handle the merge flow
      // Force reload to trigger the merge check
      window.location.reload()
    } catch (err) {
      console.error('Failed to start merge flow:', err)
      sessionStorage.removeItem('merge_token')
      setMergeError('An unexpected error occurred')
    } finally {
      setMergeLoading(false)
    }
  }

  const groupedAttributes = useMemo(() => {
    return attributes.reduce<Record<string, ProfileAttribute[]>>((acc, attr) => {
      if (!acc[attr.attribute_key]) {
        acc[attr.attribute_key] = []
      }
      acc[attr.attribute_key].push(attr)
      return acc
    }, {})
  }, [attributes])

  const preferredAttributes = useMemo(() => {
    return attributes.reduce<Record<string, ProfileAttribute>>((acc, attr) => {
      if (attr.is_preferred) {
        acc[attr.attribute_key] = attr
      }
      return acc
    }, {})
  }, [attributes])

  const preferredDisplayName = preferredAttributes['display_name']?.attribute_value || profiles[0]?.display_name || 'Unnamed Profile'
  const preferredEmail = preferredAttributes['primary_email']?.attribute_value || session?.user?.email
  const preferredAvatar = preferredAttributes['avatar_url']?.attribute_value
  const totalLinkedProviders = useMemo(
    () => Object.values(linkCounts).reduce((sum, val) => sum + val, 0),
    [linkCounts],
  )

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center py-4 mb-8" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <img
              src={preferredAvatar || '/nomen.svg'}
              alt="Profile"
              className={`w-10 h-10 rounded-full ${preferredAvatar ? 'object-cover' : 'dark:invert'}`}
            />
            <div>
              <h1 className="text-2xl font-semibold">{preferredDisplayName}</h1>
              <p className="text-sm opacity-70">{preferredEmail}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 text-sm rounded cursor-pointer"
            style={{ border: '1px solid var(--border)' }}
          >
            Sign Out
          </button>
        </header>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-medium">Your Profiles</h2>
          </div>

          {profiles.length === 0 ? (
            <div className="p-8 text-center rounded" style={{ border: '1px solid var(--border)' }}>
              <p className="opacity-70">No profiles yet</p>
              <p className="text-sm opacity-50 mt-2">Connect your accounts to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="p-4 rounded"
                  style={{ border: '1px solid var(--border)' }}
                >
                  <div className="font-medium">{profile.display_name || 'Unnamed Profile'}</div>
                  <div className="text-sm opacity-70 mt-1">{profile.primary_email}</div>
                  <div className="text-xs opacity-50 mt-2">
                    Created: {new Date(profile.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-medium">Linking ({totalLinkedProviders})</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              {providerOptions.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => startLinkFlow(id)}
                  className={`px-3 py-1 rounded ${!user?.profile_id ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-80'}`}
                  style={{ border: '1px solid var(--border)' }}
                  disabled={!user?.profile_id}
                >
                  {label}: {linkCounts[id] ?? 0}
                </button>
              ))}
            </div>
          </div>

          {!user?.profile_id ? (
            <div className="p-6 rounded" style={{ border: '1px solid var(--border)' }}>
              <p className="opacity-70">No merged profile yet.</p>
              <p className="opacity-60 text-sm">Sign in with an OAuth provider to create one.</p>
            </div>
          ) : null}
        </div>

        {/* Merge Another Account Section */}
        {user?.profile_id && (
          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-medium">Merge Another Account</h2>
              <button
                onClick={() => setShowMergeProviders(!showMergeProviders)}
                className="text-sm px-3 py-1 rounded cursor-pointer"
                style={{ border: '1px solid var(--border)' }}
              >
                {showMergeProviders ? 'Cancel' : 'Merge'}
              </button>
            </div>

            {showMergeProviders && (
              <div className="p-4 rounded" style={{ border: '1px solid var(--border)' }}>
                <p className="text-sm opacity-70 mb-4">
                  Sign in with your other account. After authentication, you can merge it into this one.
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => startMergeFlow('google')}
                    disabled={mergeLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    <span className="flex-1 text-left">Continue with Google</span>
                  </button>
                  <button
                    onClick={() => startMergeFlow('github')}
                    disabled={mergeLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
                    <span className="flex-1 text-left">Continue with GitHub</span>
                  </button>
                  <button
                    onClick={() => startMergeFlow('linkedin_oidc')}
                    disabled={mergeLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    <span className="flex-1 text-left">Continue with LinkedIn</span>
                  </button>
                  <button
                    onClick={() => startMergeFlow('discord')}
                    disabled={mergeLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2214C38.1637 3.4046 32.7345 3.4046 27.3892 4.2214C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9427 10.7825 4.9796C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.557C6.45866 50.0174 12.3413 52.7249 18.1363 54.5195C18.2295 54.5475 18.3292 54.5134 18.3868 54.4376C19.7295 52.5728 20.9337 50.6063 21.9816 48.5383C22.0436 48.4172 21.9932 48.2735 21.8676 48.2232C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5042 16.1781 45.304 16.3075 45.2082C16.679 44.9293 17.0505 44.6391 17.4067 44.346C17.4715 44.2921 17.5604 44.2813 17.6362 44.3132C29.2558 49.0157 41.8354 49.0157 53.3179 44.3132C53.3937 44.2789 53.4826 44.2897 53.5474 44.3436C53.9036 44.6367 54.2751 44.9293 54.6494 45.2082C54.7788 45.304 54.7705 45.5042 54.6306 45.5858C52.8619 46.6197 51.0233 47.495 49.0923 48.2232C48.9667 48.2735 48.9198 48.4172 48.9818 48.5383C50.0546 50.6034 51.2587 52.5699 52.5862 54.4355C52.6404 54.5134 52.7428 54.5475 52.836 54.5195C58.668 52.7249 64.5506 50.0174 70.6235 45.557C70.6766 45.5182 70.7102 45.4582 70.7158 45.3934C72.1971 30.0791 68.2136 16.7757 60.1968 4.9824C60.1772 4.9427 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.937 34.1136 40.937 30.1693C40.937 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z"/></svg>
                    <span className="flex-1 text-left">Continue with Discord</span>
                  </button>
                  <button
                    onClick={() => startMergeFlow('twitter')}
                    disabled={mergeLoading}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded border hover:bg-opacity-5 hover:bg-foreground transition-colors disabled:opacity-50 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    <span className="flex-1 text-left">Continue with X</span>
                  </button>
                </div>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" style={{ borderColor: 'var(--border)' }}></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-2 bg-background opacity-70">or</span>
                  </div>
                </div>

                <form onSubmit={startMergeWithEmail} className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email"
                    value={mergeEmail}
                    onChange={(e) => setMergeEmail(e.target.value)}
                    required
                    disabled={mergeLoading}
                    className="w-full px-3 py-2 border rounded bg-background text-sm disabled:opacity-50"
                    style={{ borderColor: 'var(--border)' }}
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={mergePassword}
                    onChange={(e) => setMergePassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={mergeLoading}
                    className="w-full px-3 py-2 border rounded bg-background text-sm disabled:opacity-50"
                    style={{ borderColor: 'var(--border)' }}
                  />
                  <button
                    type="submit"
                    disabled={mergeLoading}
                    className="w-full py-2 px-4 rounded text-sm opacity-70 hover:opacity-100 disabled:opacity-50 cursor-pointer"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {mergeLoading ? 'Please wait...' : 'Sign in with Email'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-medium">Attributes</h2>
          </div>

          {!user?.profile_id ? (
            <div className="p-6 rounded" style={{ border: '1px solid var(--border)' }}>
              <p className="opacity-70">No merged profile yet.</p>
              <p className="opacity-60 text-sm">Sign in with an OAuth provider to create one.</p>
            </div>
          ) : Object.keys(groupedAttributes).length === 0 ? (
            <div className="p-6 rounded" style={{ border: '1px solid var(--border)' }}>
              <p className="opacity-70">No harvested attributes yet.</p>
              <p className="opacity-60 text-sm">Connect an account to pull profile details.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedAttributes).map(([key, options]) => (
                <div key={key} className="p-4 rounded" style={{ border: '1px solid var(--border)' }}>
                  <div className="font-medium mb-3">{key.replace('_', ' ')}</div>
                  <div className="space-y-2">
                    {options.map((option) => (
                      <div
                        key={option.id}
                        className="flex items-center justify-between gap-4 p-3 rounded"
                        style={{ border: option.is_preferred ? '1px solid var(--accent)' : '1px solid var(--border)' }}
                      >
                        <div className="flex items-center gap-3">
                          {key === 'avatar_url' && (
                            <img
                              src={option.attribute_value}
                              alt="avatar"
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          )}
                          <div>
                            <div className="text-sm">
                              {key === 'avatar_url' ? (
                                <a
                                  href={option.attribute_value}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline cursor-pointer"
                                >
                                  {option.attribute_value}
                                </a>
                              ) : (
                                option.attribute_value
                              )}
                            </div>
                            <div className="text-xs opacity-60">
                              Source: {option.source_provider || 'unknown'}
                              {option.identity_id && (
                                <span className="ml-1 opacity-50">({option.identity_id.substring(0, 8)}...)</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {!option.is_preferred && (
                          <button
                            onClick={() => handleSetPreferred(option.id)}
                            className="text-sm px-3 py-1 rounded cursor-pointer"
                            style={{ border: '1px solid var(--border)' }}
                          >
                            Use this
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 p-4 rounded" style={{ backgroundColor: 'var(--accent)', color: 'white', opacity: 0.9 }}>
          <h3 className="font-medium mb-2">Connected as</h3>
          <div className="flex items-center gap-3">
            {preferredAvatar && (
              <img src={preferredAvatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
            )}
            <div>
              <div className="font-medium">{preferredDisplayName}</div>
              <p className="text-sm opacity-90">{preferredEmail}</p>
            </div>
          </div>
        </div>

        {/* Show merged accounts info if any */}
        {profiles[0]?.merged_user_ids && profiles[0].merged_user_ids.length > 0 && (
          <div className="mt-4 p-4 rounded" style={{ border: '1px solid var(--border)' }}>
            <h3 className="font-medium mb-2">Merged Accounts</h3>
            <p className="text-sm opacity-70">
              This profile includes data from {profiles[0].merged_user_ids.length} merged account(s).
            </p>
            <div className="text-xs opacity-50 mt-2">
              IDs: {profiles[0].merged_user_ids.map(id => id.substring(0, 8)).join(', ')}...
            </div>
          </div>
        )}

        {/* Error message display */}
        {mergeError && (
          <div className="mt-4 p-4 rounded bg-red-50 dark:bg-red-900/20" style={{ border: '1px solid #ef4444' }}>
            <p className="text-red-600 dark:text-red-400">{mergeError}</p>
            <button
              onClick={() => setMergeError(null)}
              className="text-sm mt-2 opacity-70 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Merge Confirmation Dialog */}
      {pendingMergeToken && mergeRequesterInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full p-6" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-xl font-semibold mb-4">Merge Account Request</h2>

            <p className="mb-4 opacity-80">
              Another account has requested to merge your account into theirs.
              If you accept, your account will be absorbed and you will need to sign in again.
            </p>

            <div className="p-4 rounded mb-4" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--background)' }}>
              <div className="text-sm opacity-60 mb-1">Requesting account:</div>
              <div className="font-medium">
                {mergeRequesterInfo.display_name || 'Unknown User'}
              </div>
              <div className="text-sm opacity-70">
                {mergeRequesterInfo.email || 'No email'}
              </div>
            </div>

            <p className="text-sm opacity-60 mb-4">
              After merging, all your linked providers and profile data will be moved to the requesting account.
              Your current account will be deleted.
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={rejectMerge}
                disabled={mergeLoading}
                className="px-4 py-2 text-sm rounded cursor-pointer"
                style={{ border: '1px solid var(--border)' }}
              >
                {mergeLoading ? 'Please wait...' : 'Reject'}
              </button>
              <button
                onClick={confirmMerge}
                disabled={mergeLoading}
                className="px-4 py-2 text-sm rounded cursor-pointer text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {mergeLoading ? 'Merging...' : 'Accept & Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
