import type {
  CreateSpaceInput,
  EditableSpaceFields,
  RemovalImpact,
  SpaceDetail,
  SpaceFile,
  SpaceMember,
  SpaceRole,
  SpaceStatus,
  SpaceSummary,
  UserRef
} from '~/types/api'

export type SpaceScope = 'mine' | 'all'

export function useSpaceList(scope: MaybeRefOrGetter<SpaceScope> = 'mine') {
  const api = useMasarApi()
  return useMasarQuery<SpaceSummary[]>(
    () => `spaces:list:${toValue(scope)}`,
    signal => api.get('masar.api.spaces.list', { scope: toValue(scope) }, signal),
    { default: () => [] }
  )
}

export function useSpaceDetail(space: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<SpaceDetail | null>(
    () => `space:${toValue(space)}`,
    signal => api.get('masar.api.spaces.get', { space: toValue(space) }, signal),
    { default: () => null }
  )
}

/** The shared Space category list (client revision 5); new names join it when a Space is saved. */
export function useSpaceCategories() {
  const api = useMasarApi()
  return useMasarQuery<string[]>('spaces:categories', signal => api.get('masar.api.spaces.categories', {}, signal), { default: () => [] })
}

export function useSpaceMembers(space: MaybeRefOrGetter<string | null | undefined>) {
  const api = useMasarApi()
  return useMasarQuery<SpaceMember[]>(
    () => `space-members:${toValue(space) ?? ''}`,
    // No Space (e.g. a cross-Space selection): nothing to load.
    async signal => (toValue(space) ? api.get<SpaceMember[]>('masar.api.spaces.members', { space: toValue(space) }, signal) : []),
    { default: () => [] }
  )
}

/** Active Masar users for pickers; `space` excludes existing members and requires manage rights. */
export function useSpaceFiles(space: MaybeRefOrGetter<string>) {
  const api = useMasarApi()
  return useMasarQuery<SpaceFile[]>(
    () => `space-files:${toValue(space)}`,
    signal => api.get('masar.api.spaces.files', { space: toValue(space) }, signal),
    { default: () => [] }
  )
}

export function uploadSpaceFile(space: string, file: File, onProgress?: (percent: number) => void) {
  return uploadMultipart<SpaceFile>('masar.api.spaces.upload_file', { space }, file, onProgress)
}

export function useSpaceFileMutations() {
  const api = useMasarApi()
  const remove = useMasarMutation(
    (vars: { space: string, file: string }) => api.post('masar.api.spaces.delete_file', { space_file: vars.file }),
    { invalidate: (_r, vars) => [`space-files:${vars.space}`] }
  )
  return { remove }
}

export function searchUserCandidates(query: string, space?: string) {
  return useMasarApi().get<UserRef[]>('masar.api.spaces.user_candidates', { query, space })
}

export function fetchRemovalImpact(space: string, user: string) {
  return useMasarApi().get<RemovalImpact>('masar.api.spaces.removal_impact', { space, user })
}

/** Store the server's authoritative Space and refresh dependent views. */
function applySpace(space: SpaceDetail | null | undefined) {
  if (!space) return
  writeCache(`space:${space.name}`, space)
  void invalidateQueries('spaces:list', 'spaces:categories', `space-members:${space.name}`, `tasks:list:${space.name}:`)
}

export function useSpaceMutations() {
  const api = useMasarApi()
  const { loadBoot } = useSession()
  const conflictsAreHandledInline = { toastOnError: (e: { kind: string }) => e.kind !== 'conflict' }

  const create = useMasarMutation(
    (data: CreateSpaceInput) => api.post<SpaceDetail>('masar.api.spaces.create', { data }),
    { onSuccess: space => applySpace(space), toastOnError: false }
  )

  const update = useMasarMutation(
    (vars: { space: SpaceDetail, changes: Partial<EditableSpaceFields> }) => {
      const base: Record<string, unknown> = {}
      for (const key of Object.keys(vars.changes)) base[key] = (vars.space as unknown as Record<string, unknown>)[key]
      return api.post<SpaceDetail>('masar.api.spaces.update', { space: vars.space.name, changes: vars.changes, base })
    },
    { onSuccess: space => applySpace(space), ...conflictsAreHandledInline }
  )

  const setStatus = useMasarMutation(
    (vars: { space: SpaceDetail, status: SpaceStatus }) =>
      api.post<SpaceDetail>('masar.api.spaces.set_status', {
        space: vars.space.name,
        status: vars.status,
        expected_status: vars.space.status
      }),
    { onSuccess: space => applySpace(space) }
  )

  const addMember = useMasarMutation(
    (vars: { space: string, user: string, role: SpaceRole }) =>
      api.post<SpaceDetail>('masar.api.spaces.add_member', vars),
    { onSuccess: space => applySpace(space) }
  )

  const changeRole = useMasarMutation(
    (vars: { space: string, user: string, role: SpaceRole }) =>
      api.post<SpaceDetail>('masar.api.spaces.change_role', vars),
    { onSuccess: space => applySpace(space) }
  )

  const removeMember = useMasarMutation(
    (vars: { space: string, user: string }) =>
      api.post<{ space: SpaceDetail | null, tasksUpdated: number }>('masar.api.spaces.remove_member', vars),
    {
      onSuccess: (result, vars) => {
        if (result.space) applySpace(result.space)
        else void invalidateQueries(`space:${vars.space}`, 'spaces:list')
        // Removing yourself ends your access: refresh the session's Space list.
        if (!result.space) void loadBoot(true)
      }
    }
  )

  const transferOwnership = useMasarMutation(
    (vars: { space: SpaceDetail, newOwner: string }) =>
      api.post<SpaceDetail>('masar.api.spaces.transfer_ownership', {
        space: vars.space.name,
        new_owner: vars.newOwner,
        expected_owner: vars.space.owner.name
      }),
    { onSuccess: space => applySpace(space) }
  )

  return { create, update, setStatus, addMember, changeRole, removeMember, transferOwnership }
}
