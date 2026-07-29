import type { BudgetTransferFormData } from '../types/budgetTransfer'

const DRAFT_STORAGE_KEY = 'budget-transfer-draft'

export function saveDraft(data: BudgetTransferFormData): void {
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data))
}

export function loadDraft(): BudgetTransferFormData | null {
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as BudgetTransferFormData
  } catch {
    return null
  }
}

export function clearDraft(): void {
  window.localStorage.removeItem(DRAFT_STORAGE_KEY)
}

export function hasDraft(): boolean {
  return window.localStorage.getItem(DRAFT_STORAGE_KEY) !== null
}
