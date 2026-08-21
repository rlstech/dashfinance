import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/services/api'
import { ShieldCheck, UserPlus, Pencil, UserX } from 'lucide-react'
import { EMPRESA_COLORS } from '@/types'
import type { User } from '@/types'

const ALL_EMPRESAS = Object.keys(EMPRESA_COLORS)

interface UserForm {
  email: string
  name: string
  password: string
  is_admin: boolean
  is_active: boolean
  empresas: string[]
}

const emptyForm = (): UserForm => ({
  email: '',
  name: '',
  password: '',
  is_admin: false,
  is_active: true,
  empresas: [],
})

function useAdminUsers() {
  return useQuery<User[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users'),
  })
}

export default function Admin() {
  useEffect(() => { document.title = 'Admin | DashFinance' }, [])
  const qc = useQueryClient()
  const { data: users, isLoading } = useAdminUsers()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm())
  const [formError, setFormError] = useState('')

  const createUser = useMutation({
    mutationFn: (body: UserForm) => api.post('/admin/users', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); closeModal() },
    onError: (e: Error) => setFormError(e.message),
  })

  const updateUser = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<UserForm> }) =>
      api.put(`/admin/users/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); closeModal() },
    onError: (e: Error) => setFormError(e.message),
  })

  const deactivateUser = useMutation({
    mutationFn: (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  function openNew() {
    setEditingId(null)
    setForm(emptyForm())
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(user: User) {
    setEditingId(user.id)
    setForm({ email: user.email, name: user.name, password: '', is_admin: user.is_admin, is_active: user.is_active, empresas: user.empresas })
    setFormError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    setFormError('')
  }

  function toggleEmpresa(e: string) {
    setForm((f) => ({
      ...f,
      empresas: f.empresas.includes(e) ? f.empresas.filter((x) => x !== e) : [...f.empresas, e],
    }))
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setFormError('')
    if (editingId) {
      const body: Partial<UserForm> = { name: form.name, is_admin: form.is_admin, is_active: form.is_active, empresas: form.empresas }
      if (form.password) body.password = form.password
      updateUser.mutate({ id: editingId, body })
    } else {
      if (!form.password) { setFormError('Senha obrigatória'); return }
      createUser.mutate(form)
    }
  }

  const isPending = createUser.isPending || updateUser.isPending

  return (
    <div className="flex h-full min-h-0">
      <div className="w-full overflow-auto p-5 md:p-7">
        <div className="mx-auto max-w-5xl space-y-6">

          <div className="flex items-center justify-between">
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-[-0.03em]">
              <ShieldCheck className="h-6 w-6 text-brand" aria-hidden="true" />
              Administração
            </h1>
            <button
              type="button"
              onClick={openNew}
              className="flex items-center gap-2 rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Novo Usuário
            </button>
          </div>

          <div className="data-panel overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="text-sm font-semibold text-dark">Usuários do sistema</h2>
            </div>

            {isLoading ? (
              <p className="p-6 text-xs text-muted-foreground font-bold uppercase">Carregando...</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                   <tr className="border-b border-line bg-bgBase">
                     <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Nome</th>
                     <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:table-cell">E-mail</th>
                     <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:table-cell">Empresas</th>
                     <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Admin</th>
                     <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ativo</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {users?.map((u) => (
                     <tr key={u.id} className="border-b border-grid transition-colors last:border-0 hover:bg-bgBase">
                      <td className="px-4 py-3 font-bold">{u.name}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{u.email}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {u.empresas.length === ALL_EMPRESAS.length ? (
                            <span className="bg-dark text-white px-2 py-0.5 font-black uppercase text-[10px]">Todas</span>
                          ) : (
                            u.empresas.map((emp) => (
                              <span
                                key={emp}
                                className="px-2 py-0.5 font-black uppercase text-[10px] text-white"
                                style={{ backgroundColor: EMPRESA_COLORS[emp] ?? '#666' }}
                              >
                                {emp}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {u.is_admin && <ShieldCheck className="h-4 w-4 text-brand inline-block" />}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                          {u.is_active ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-1.5 text-muted-foreground hover:text-dark transition-colors"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {u.is_active && (
                            <button
                              onClick={() => deactivateUser.mutate(u.id)}
                              className="p-1.5 text-muted-foreground hover:text-red-600 transition-colors"
                              title="Desativar"
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-line p-5">
              <h2 className="text-sm font-semibold text-dark">
                {editingId ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button type="button" onClick={closeModal} aria-label="Fechar" className="rounded-md p-1 text-lg leading-none text-muted-foreground transition-colors hover:bg-bgBase hover:text-dark">x</button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div className="space-y-2">
                <label htmlFor="admin-name" className="text-xs font-semibold text-dark">Nome</label>
                <input
                  id="admin-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-10 w-full rounded-md border border-line px-3 text-sm font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>

              {!editingId && (
                <div className="space-y-2">
                  <label htmlFor="admin-email" className="text-xs font-semibold text-dark">E-mail</label>
                  <input
                    id="admin-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="h-10 w-full rounded-md border border-line px-3 text-sm font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="admin-password" className="text-xs font-semibold text-dark">
                  Senha {editingId && <span className="normal-case font-medium">(deixe vazio para não alterar)</span>}
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="h-10 w-full rounded-md border border-line px-3 text-sm font-medium outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  placeholder="Senha"
                />
              </div>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-dark">Empresas</span>
                <div className="flex flex-wrap gap-2">
                  {ALL_EMPRESAS.map((emp) => (
                    <button
                      key={emp}
                      type="button"
                      onClick={() => toggleEmpresa(emp)}
                      className={`rounded-md border px-2.5 py-1.5 text-[10px] font-semibold uppercase transition-colors ${
                        form.empresas.includes(emp)
                          ? 'border-dark bg-dark text-white'
                          : 'border-line text-dark hover:border-brand hover:bg-bgBase'
                      }`}
                    >
                      {emp}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_admin}
                    onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
                    className="w-4 h-4 border-2 border-dark accent-brand"
                  />
                  <span className="text-xs font-semibold text-dark">Administrador</span>
                </label>
                {editingId && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="w-4 h-4 border-2 border-dark accent-brand"
                    />
                    <span className="text-xs font-semibold text-dark">Ativo</span>
                  </label>
                )}
              </div>

              {formError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-negative">{formError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 rounded-md bg-dark px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand hover:text-dark disabled:opacity-50"
                >
                  {isPending ? 'Salvando...' : editingId ? 'Salvar' : 'Criar'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-line px-4 py-2 text-xs font-semibold text-dark transition-colors hover:border-brand hover:bg-bgBase"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
