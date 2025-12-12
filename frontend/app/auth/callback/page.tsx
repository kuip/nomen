'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleCallback = async () => {
      // Get the code from URL (OAuth PKCE flow)
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const queryParams = new URLSearchParams(window.location.search)

      const code = queryParams.get('code')
      const errorCode = queryParams.get('error')
      const errorDescription = queryParams.get('error_description')

      if (errorCode) {
        console.error('OAuth error:', errorCode, errorDescription)
        setError(errorDescription || errorCode)
        setTimeout(() => router.push('/auth'), 3000)
        return
      }

      // Supabase automatically handles the code exchange via onAuthStateChange
      // Just wait for the session to be established
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()

      if (sessionError) {
        console.error('Session error:', sessionError)
        setError(sessionError.message)
        setTimeout(() => router.push('/auth'), 3000)
        return
      }

      if (session) {
        router.push('/dashboard')
      } else {
        // No session yet, wait for auth state change
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            subscription.unsubscribe()
            router.push('/dashboard')
          }
        })

        // Timeout after 5 seconds
        setTimeout(() => {
          subscription.unsubscribe()
          if (!session) {
            setError('Authentication timeout')
            router.push('/auth')
          }
        }, 5000)
      }
    }

    handleCallback()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        {error ? (
          <>
            <div className="text-red-500 mb-2">Authentication failed</div>
            <div className="text-sm opacity-70">{error}</div>
            <div className="text-xs opacity-50 mt-2">Redirecting...</div>
          </>
        ) : (
          <div>Processing authentication...</div>
        )}
      </div>
    </div>
  )
}
