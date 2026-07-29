import { useCallback, useState } from 'react'
import type { BudgetTransferFormData } from '../types/budgetTransfer'
import {
  clearDraft as clearStoredDraft,
  hasDraft as hasStoredDraft,
  loadDraft as loadStoredDraft,
  saveDraft as saveStoredDraft,
} from '../utils/draftStorage'

export function useLocalDraft() {
  const [draftAvailable, setDraftAvailable] = useState(hasStoredDraft)
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null)

  const save = useCallback((data: BudgetTransferFormData) => {
    saveStoredDraft(data)
    setDraftAvailable(true)
    setLastSavedLabel(new Date().toLocaleTimeString())
  }, [])

  const load = useCallback((): BudgetTransferFormData | null => loadStoredDraft(), [])

  const clear = useCallback(() => {
    clearStoredDraft()
    setDraftAvailable(false)
  }, [])

  return { draftAvailable, lastSavedLabel, save, load, clear }
}
