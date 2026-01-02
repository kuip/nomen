'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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

function DashboardContent() {
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
  const router = useRouter()

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()

      // Handle invalid/expired refresh token
      if (error) {
        console.error('Session error:', error)
        await supabase.auth.signOut()
        router.push('/auth')
        return
      }

      if (!session) {
        router.push('/auth')
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
        router.push('/auth')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

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
    router.push('/auth')
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
      const { data, error } = await supabase.auth.linkIdentity({
        provider: provider as any,
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
        router.push('/auth')
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
        provider: provider as any,
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
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
                  Select a provider to sign in with your other account. After authentication,
                  that account will be merged into this one.
                </p>
                <div className="flex flex-wrap gap-2">
                  {providerOptions.map(({ id, label }) => (
                    <button
                      key={id}
                      onClick={() => startMergeFlow(id)}
                      disabled={mergeLoading}
                      className="px-4 py-2 rounded cursor-pointer hover:opacity-80 disabled:opacity-50"
                      style={{ border: '1px solid var(--border)' }}
                    >
                      {mergeLoading ? 'Please wait...' : `Sign in with ${label}`}
                    </button>
                  ))}
                </div>
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
                            // eslint-disable-next-line @next/next/no-img-element
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
              // eslint-disable-next-line @next/next/no-img-element
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

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div>Loading...</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
