import type { ReactNode } from 'react'

export const metadata = {
  title: 'Turnero',
  description: 'Agenda con confirmación automática de turnos',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  )
}
