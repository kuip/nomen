import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import OAuthButton from '@/components/OAuthButton'

export default function AuthPage() {
  const [isSignup, setIsSignup] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        navigate('/dashboard')
      }
    }

    checkAuth()
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
      navigate('/dashboard')
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An error occurred')
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <img
            src="/nomen.svg"
            alt="Nomen"
            className="w-16 h-16 mx-auto mb-4 dark:invert"
          />
          <h1 className="text-2xl font-semibold">Sign In</h1>
          <p className="text-sm mt-1 opacity-70">Connect with your accounts</p>
        </div>

        <div className="space-y-3">
          <OAuthButton
            provider="google"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>}
            label="Continue with Google"
          />
          <OAuthButton
            provider="github"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>}
            label="Continue with Github"
          />
          <OAuthButton
            provider="linkedin_oidc"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>}
            label="Continue with LinkedIn"
          />
          <OAuthButton
            provider="facebook"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>}
            label="Continue with Facebook"
          />
          <OAuthButton
            provider="discord"
            icon={<svg className="w-5 h-5" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2214C38.1637 3.4046 32.7345 3.4046 27.3892 4.2214C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9427 10.7825 4.9796C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.557C6.45866 50.0174 12.3413 52.7249 18.1363 54.5195C18.2295 54.5475 18.3292 54.5134 18.3868 54.4376C19.7295 52.5728 20.9337 50.6063 21.9816 48.5383C22.0436 48.4172 21.9932 48.2735 21.8676 48.2232C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5042 16.1781 45.304 16.3075 45.2082C16.679 44.9293 17.0505 44.6391 17.4067 44.346C17.4715 44.2921 17.5604 44.2813 17.6362 44.3132C29.2558 49.0157 41.8354 49.0157 53.3179 44.3132C53.3937 44.2789 53.4826 44.2897 53.5474 44.3436C53.9036 44.6367 54.2751 44.9293 54.6494 45.2082C54.7788 45.304 54.7705 45.5042 54.6306 45.5858C52.8619 46.6197 51.0233 47.495 49.0923 48.2232C48.9667 48.2735 48.9198 48.4172 48.9818 48.5383C50.0546 50.6034 51.2587 52.5699 52.5862 54.4355C52.6404 54.5134 52.7428 54.5475 52.836 54.5195C58.668 52.7249 64.5506 50.0174 70.6235 45.557C70.6766 45.5182 70.7102 45.4582 70.7158 45.3934C72.1971 30.0791 68.2136 16.7757 60.1968 4.9824C60.1772 4.9427 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.937 34.1136 40.937 30.1693C40.937 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z"/></svg>}
            label="Continue with Discord"
          />
          <OAuthButton
            provider="tiktok"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>}
            label="Continue with TikTok"
          />
          <OAuthButton
            provider="twitter"
            icon={<svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>}
            label="Continue with X"
          />
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" style={{ borderColor: 'var(--border)' }}></div>
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2 bg-background opacity-70">or</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              id="email"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded bg-background text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <input
              id="password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3 py-2 border rounded bg-background text-sm"
              style={{ borderColor: 'var(--border)' }}
            />
          </div>

          {error && (
            <div className="text-sm p-2 rounded" style={{ backgroundColor: '#fee', color: '#c00' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 px-4 rounded text-sm opacity-70 hover:opacity-100 cursor-pointer"
            style={{ border: '1px solid var(--border)' }}
          >
            {isSignup ? 'Sign Up with Email' : 'Sign In with Email'}
          </button>
        </form>

        <button
          onClick={() => setIsSignup(!isSignup)}
          className="text-xs w-full text-center opacity-50 hover:opacity-100 cursor-pointer"
        >
          {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  )
}
