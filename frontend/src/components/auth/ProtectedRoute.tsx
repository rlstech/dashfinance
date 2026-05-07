import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/hooks/useAuth'

interface Props {
  children: React.ReactNode
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: Props) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && !user?.is_admin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
