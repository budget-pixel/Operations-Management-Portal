import { isValidAmount } from './currency'
import type { BudgetTransferFormData, FormErrors, TransferLine } from '../types/budgetTransfer'

function validateTransferLines(lines: TransferLine[], prefix: string, errors: FormErrors): boolean {
  let hasCompleteRow = false

  lines.forEach((line, index) => {
    const hasAccount = line.accountNumber.trim() !== ''
    const hasAmount = line.amount.trim() !== ''

    if (hasAccount && !hasAmount) {
      errors[`${prefix}.${index}.amount`] = 'Enter an amount for this account.'
    } else if (hasAmount && !isValidAmount(line.amount)) {
      errors[`${prefix}.${index}.amount`] = 'Enter a valid amount greater than 0.'
    } else if (!hasAccount && hasAmount) {
      errors[`${prefix}.${index}.accountNumber`] = 'Enter an account number for this amount.'
    }

    if (hasAccount && hasAmount && isValidAmount(line.amount)) {
      hasCompleteRow = true
    }
  })

  return hasCompleteRow
}

export function validateBudgetTransferForm(data: BudgetTransferFormData): FormErrors {
  const errors: FormErrors = {}

  if (!data.date.trim()) {
    errors.date = 'Date is required.'
  }
  if (!data.department.trim()) {
    errors.department = 'Department is required.'
  }
  if (!data.preparedBy.trim()) {
    errors.preparedBy = 'Prepared by is required.'
  }
  if (!data.title.trim()) {
    errors.title = 'Title is required.'
  }
  if (!data.amendmentType) {
    errors.amendmentType = 'Select an amendment type.'
  }

  const hasFromRow = validateTransferLines(data.transferFrom, 'transferFrom', errors)
  if (!hasFromRow) {
    errors.transferFrom = 'Add at least one Transfer From account and amount.'
  }

  const hasToRow = validateTransferLines(data.transferTo, 'transferTo', errors)
  if (!hasToRow) {
    errors.transferTo = 'Add at least one Transfer To account and amount.'
  }

  return errors
}
