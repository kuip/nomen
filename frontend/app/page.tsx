'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.push('/dashboard')
      }
    }

    checkAuth()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg text-center space-y-6">
        <div className="flex justify-center mb-4">
          <Image
            src="/nomen.svg"
            alt="Nomen"
            width={120}
            height={120}
            priority
            className="dark:invert"
          />
        </div>
        <h1 className="text-4xl font-semibold">Nomen</h1>
        <p className="opacity-70">
          Collate identity proofs from multiple platforms and merge profiles
        </p>
        <div className="flex gap-4 justify-center mt-8">
          <Link
            href="/auth"
            className="px-6 py-3 rounded font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  )
}
