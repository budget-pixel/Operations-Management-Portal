import { useMemo, useState } from 'react'
import type { BudgetTransferFormData, FormErrors, TransferLine } from '../types/budgetTransfer'
import { sumAmounts } from '../utils/currency'
import { validateBudgetTransferForm } from '../utils/validation'

export type TransferSection = 'transferFrom' | 'transferTo'

const EMPTY_ROW_COUNT = 5

function createEmptyLine(): TransferLine {
  return { id: crypto.randomUUID(), accountNumber: '', amount: '' }
}

export function createInitialFormData(): BudgetTransferFormData {
  return {
    date: '',
    department: '',
    description: '',
    preparedBy: '',
    title: '',
    amendmentType: '',
    transferFrom: Array.from({ length: EMPTY_ROW_COUNT }, createEmptyLine),
    transferTo: Array.from({ length: EMPTY_ROW_COUNT }, createEmptyLine),
  }
}

export function useBudgetTransferForm() {
  const [formData, setFormData] = useState<BudgetTransferFormData>(createInitialFormData)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitted, setIsSubmitted] = useState(false)

  const fromTotal = useMemo(
    () => sumAmounts(formData.transferFrom.map((line) => line.amount)),
    [formData.transferFrom],
  )
  const toTotal = useMemo(
    () => sumAmounts(formData.transferTo.map((line) => line.amount)),
    [formData.transferTo],
  )

  function updateField<K extends keyof BudgetTransferFormData>(field: K, value: BudgetTransferFormData[K]) {
    setFormData((prev) => ({ ...prev, [field]: value }) as BudgetTransferFormData)
    setErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field as string]
      return next
    })
    setIsSubmitted(false)
  }

  function updateTransferLine(section: TransferSection, id: string, field: keyof Omit<TransferLine, 'id'>, value: string) {
    setFormData(
      (prev) =>
        ({
          ...prev,
          [section]: prev[section].map((line) =>
            line.id === id ? ({ ...line, [field]: value } as TransferLine) : line,
          ),
        }) as BudgetTransferFormData,
    )
    setErrors((prev) => {
      const index = formData[section].findIndex((line) => line.id === id)
      if (index === -1) return prev
      const key = `${section}.${index}.${field}`
      if (!(key in prev) && !(section in prev)) return prev
      const next = { ...prev }
      delete next[key]
      delete next[section]
      return next
    })
    setIsSubmitted(false)
  }

  function addTransferLine(section: TransferSection) {
    setFormData(
      (prev) => ({ ...prev, [section]: [...prev[section], createEmptyLine()] }) as BudgetTransferFormData,
    )
  }

  function removeTransferLine(section: TransferSection, id: string) {
    setFormData((prev) => {
      if (prev[section].length <= 1) return prev
      return { ...prev, [section]: prev[section].filter((line) => line.id !== id) } as BudgetTransferFormData
    })
  }

  function validate(): boolean {
    const nextErrors = validateBudgetTransferForm(formData)
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  function submit(): boolean {
    const isValid = validate()
    setIsSubmitted(isValid)
    return isValid
  }

  function resetForm() {
    setFormData(createInitialFormData())
    setErrors({})
    setIsSubmitted(false)
  }

  function loadFormData(data: BudgetTransferFormData) {
    setFormData(data)
    setErrors({})
    setIsSubmitted(false)
  }

  return {
    formData,
    errors,
    isSubmitted,
    fromTotal,
    toTotal,
    updateField,
    updateTransferLine,
    addTransferLine,
    removeTransferLine,
    submit,
    resetForm,
    loadFormData,
  }
}
