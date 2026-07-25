'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { completarOnboardingAction, type EstadoOnboarding } from './actions'

const estilo = {
  campo: { display: 'block', marginBottom: '1rem' } as const,
  label: {
    display: 'block',
    fontSize: '0.875rem',
    color: '#333',
    marginBottom: 4,
  } as const,
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: 4,
    border: '1px solid #ccc',
    fontSize: '1rem',
  } as const,
  hint: { fontSize: '0.75rem', color: '#888', marginTop: 4 } as const,
  boton: {
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    background: '#0ea5e9',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    fontWeight: 600,
    cursor: 'pointer',
  } as const,
  error: {
    background: '#fee',
    border: '1px solid #f88',
    padding: '0.75rem',
    borderRadius: 4,
    marginBottom: '1rem',
  } as const,
}

export function OnboardingForm() {
  const [estado, action, pending] = useActionState<EstadoOnboarding | null, FormData>(
    completarOnboardingAction,
    null,
  )
  const router = useRouter()

  useEffect(() => {
    if (estado?.ok) router.push(estado.redirectTo)
  }, [estado, router])

  return (
    <form action={action}>
      {estado && !estado.ok && <div style={estilo.error}>{estado.error}</div>}

      <div style={estilo.campo}>
        <label htmlFor="nombrePublico" style={estilo.label}>
          Nombre público del estudio o consultorio
        </label>
        <input
          id="nombrePublico"
          name="nombrePublico"
          required
          style={estilo.input}
          placeholder="Dra. Ana Martínez"
        />
        <p style={estilo.hint}>Es lo que ven tus clientes en el link de reserva.</p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="slug" style={estilo.label}>Slug (URL)</label>
        <input
          id="slug"
          name="slug"
          required
          style={estilo.input}
          placeholder="dra-ana"
          pattern="[a-z0-9-]+"
        />
        <p style={estilo.hint}>
          turnero.app/<strong>tu-slug</strong>. Minúsculas, guiones, sin espacios.
        </p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="telefonoWhatsapp" style={estilo.label}>
          WhatsApp del estudio (formato +54...)
        </label>
        <input
          id="telefonoWhatsapp"
          name="telefonoWhatsapp"
          required
          style={estilo.input}
          placeholder="+5491100000000"
        />
        <p style={estilo.hint}>Solo para los avisos automáticos. Nunca se muestra al cliente.</p>
      </div>

      <div style={estilo.campo}>
        <label htmlFor="duracionMinutos" style={estilo.label}>
          Duración típica de un turno (min)
        </label>
        <input
          id="duracionMinutos"
          name="duracionMinutos"
          required
          type="number"
          min="5"
          max="240"
          defaultValue={30}
          style={estilo.input}
        />
        <p style={estilo.hint}>Lo podés cambiar cuando quieras.</p>
      </div>

      <button
        type="submit"
        disabled={pending}
        style={{ ...estilo.boton, opacity: pending ? 0.6 : 1 }}
      >
        {pending ? 'Creando…' : 'Crear mi agenda'}
      </button>
    </form>
  )
}
