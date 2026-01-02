'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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

interface MergeCandidate {
  other_user_id: string
  other_profile_id: string | null
  other_display_name: string | null
  other_email: string | null
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
  const [mergeCandidate, setMergeCandidate] = useState<MergeCandidate | null>(null)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        router.push('/auth')
        return
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

  // Check for merge-related URL parameters
  useEffect(() => {
    const mergeUserId = searchParams.get('merge_user')
    const errorParam = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')

    // Handle OAuth errors that might indicate identity conflict
    if (errorParam || errorDesc) {
      const errorMessage = errorDesc || errorParam || 'Authentication error'
      if (errorMessage.toLowerCase().includes('identity') ||
          errorMessage.toLowerCase().includes('already') ||
          errorMessage.toLowerCase().includes('exists')) {
        setMergeError('This provider is already linked to another account. Use the merge feature below to combine accounts.')
      } else {
        setMergeError(errorMessage)
      }
      // Clean URL
      router.replace('/dashboard')
    }

    // Handle direct merge request via URL
    if (mergeUserId && session) {
      handleMergeFromUrl(mergeUserId)
      router.replace('/dashboard')
    }
  }, [searchParams, session, router])

  async function handleMergeFromUrl(sourceUserId: string) {
    // Look up the source user's profile info
    const { data, error } = await supabase
      .from('users')
      .select('profile_id, profiles(display_name, primary_email)')
      .eq('id', sourceUserId)
      .single()

    if (error || !data) {
      setMergeError('Could not find the account to merge')
      return
    }

    const profile = data.profiles as { display_name: string | null; primary_email: string | null } | null

    setMergeCandidate({
      other_user_id: sourceUserId,
      other_profile_id: data.profile_id,
      other_display_name: profile?.display_name || null,
      other_email: profile?.primary_email || null,
    })
  }

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
        // Supabase returns this when the identity is linked to another user
        if (error.message?.toLowerCase().includes('identity') ||
            error.code === 'identity_already_exists' ||
            error.message?.toLowerCase().includes('already')) {
          // The OAuth flow was likely interrupted, user needs to try again
          // and we'll catch the conflict in the callback
          setMergeError('This provider may be linked to another account. Please try again.')
        }
      }
    } catch (err) {
      console.error('Failed to start link flow:', err)
    }
  }

  async function checkForMergeCandidate(provider: string, providerId: string) {
    try {
      const { data, error } = await supabase.rpc('check_merge_candidate', {
        p_provider: provider,
        p_provider_id: providerId,
      })

      if (error) {
        console.error('Failed to check merge candidate:', error)
        return null
      }

      if (data?.success && data?.can_merge) {
        return {
          other_user_id: data.other_user_id,
          other_profile_id: data.other_profile_id,
          other_display_name: data.other_display_name,
          other_email: data.other_email,
        } as MergeCandidate
      }

      return null
    } catch (err) {
      console.error('Failed to check merge candidate:', err)
      return null
    }
  }

  async function handleMergeAccounts() {
    if (!mergeCandidate || !session?.user?.id) return

    setMergeLoading(true)
    setMergeError(null)

    try {
      // Call the SQL function directly via RPC
      const { data, error } = await supabase.rpc('merge_profiles', {
        p_target_user_id: session.user.id,
        p_source_user_id: mergeCandidate.other_user_id,
      })

      if (error) {
        console.error('Merge error:', error)
        setMergeError(error.message || 'Failed to merge accounts')
        return
      }

      const result = data as { success: boolean; error?: string }

      if (!result.success) {
        setMergeError(result.error || 'Failed to merge accounts')
        return
      }

      // Success! Reload user data to reflect the merge
      setMergeCandidate(null)
      await loadUserData(session.user.id)
    } catch (err) {
      console.error('Failed to merge accounts:', err)
      setMergeError('An unexpected error occurred')
    } finally {
      setMergeLoading(false)
    }
  }

  function closeMergeDialog() {
    setMergeCandidate(null)
    setMergeError(null)
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
        {mergeError && !mergeCandidate && (
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
      {mergeCandidate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full p-6" style={{ border: '1px solid var(--border)' }}>
            <h2 className="text-xl font-semibold mb-4">Merge Accounts?</h2>

            <p className="mb-4 opacity-80">
              The provider you selected is linked to another account. Would you like to merge that account into your current account?
            </p>

            <div className="p-4 rounded mb-4" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--background)' }}>
              <div className="font-medium">
                {mergeCandidate.other_display_name || 'Unknown User'}
              </div>
              <div className="text-sm opacity-70">
                {mergeCandidate.other_email || 'No email'}
              </div>
            </div>

            <p className="text-sm opacity-60 mb-4">
              After merging, all linked providers and profile data from the other account will be added to your current account. The other account will continue to work but will share this profile.
            </p>

            {mergeError && (
              <div className="p-3 rounded mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                {mergeError}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={closeMergeDialog}
                disabled={mergeLoading}
                className="px-4 py-2 text-sm rounded cursor-pointer"
                style={{ border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleMergeAccounts}
                disabled={mergeLoading}
                className="px-4 py-2 text-sm rounded cursor-pointer text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {mergeLoading ? 'Merging...' : 'Yes, Merge Accounts'}
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
