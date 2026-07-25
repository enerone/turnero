import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  NOMBRE_COOKIE_PENDING,
  deserializarPendingOnboarding,
} from '@/lib/auth/pending-onboarding'
import { env } from '@/lib/shared/env'
import { OnboardingForm } from './OnboardingForm'

export default async function OnboardingPage() {
  const cookieStore = await cookies()
  const pendingCookie = cookieStore.get(NOMBRE_COOKIE_PENDING)?.value
  if (!pendingCookie) redirect('/login')

  let pending
  try {
    pending = await deserializarPendingOnboarding(pendingCookie, env.SESSION_SECRET)
  } catch {
    redirect('/login?error=state')
  }

  return (
    <main
      style={{
        maxWidth: 480,
        margin: '2rem auto',
        padding: '0 1rem',
        fontFamily: 'system-ui',
      }}
    >
      <h1 style={{ fontSize: '1.5rem' }}>
        Configurá tu agenda, {pending.nombre.split(' ')[0]}
      </h1>
      <p style={{ color: '#555', marginBottom: '1.5rem' }}>
        Tres datos y ya podés operar. Todo lo demás se ajusta después.
      </p>
      <OnboardingForm />
    </main>
  )
}
