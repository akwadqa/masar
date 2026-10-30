import { MasarApiError, errorMessage } from '~/utils/apiError'

interface MutationOptions<TVars, TResult> {
  /** Apply the optimistic change; return a rollback that restores the previous state. */
  optimistic?: (vars: TVars) => (() => void) | void
  onSuccess?: (result: TResult, vars: TVars) => void
  /** Query key prefixes to refresh after success. */
  invalidate?: (result: TResult, vars: TVars) => string[]
  /** Show a toast for failures (default true). Conflicts are usually handled by the caller. */
  toastOnError?: boolean | ((error: MasarApiError) => boolean)
}

/** Mutation with optimistic update, rollback on failure and targeted invalidation (ADR-009). */
export function useMasarMutation<TVars, TResult>(
  mutate: (vars: TVars) => Promise<TResult>,
  options: MutationOptions<TVars, TResult> = {}
) {
  const pending = ref(false)
  const error = ref<MasarApiError | null>(null)
  const toast = useToast()

  async function execute(vars: TVars): Promise<TResult> {
    pending.value = true
    error.value = null
    const rollback = options.optimistic?.(vars)
    try {
      const result = await mutate(vars)
      options.onSuccess?.(result, vars)
      const prefixes = options.invalidate?.(result, vars) ?? []
      if (prefixes.length) void invalidateQueries(...prefixes)
      return result
    } catch (caught) {
      rollback?.()
      const apiError = caught instanceof MasarApiError
        ? caught
        : new MasarApiError({ status: 0, kind: 'server', type: null, message: errorMessage(caught) })
      error.value = apiError
      const shouldToast = typeof options.toastOnError === 'function'
        ? options.toastOnError(apiError)
        : options.toastOnError !== false
      if (shouldToast && apiError.kind !== 'auth') {
        toast.add({ title: apiError.message, color: 'error', icon: 'i-lucide-circle-alert' })
      }
      throw apiError
    } finally {
      pending.value = false
    }
  }

  return { execute, pending, error }
}
