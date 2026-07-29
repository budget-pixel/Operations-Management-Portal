export type AmendmentType =
  | 'intradepartmental'
  | 'interdepartmental'
  | 'reserve'
  | 'unanticipatedRevenue'
  | 'increasedReceipts'
  | 'publicHearing'

export interface AmendmentTypeOption {
  value: AmendmentType
  label: string
  statute: string
  requires: string
}

export interface TransferLine {
  id: string
  accountNumber: string
  amount: string
}

export interface BudgetTransferFormData {
  date: string
  department: string
  description: string
  preparedBy: string
  title: string
  amendmentType: AmendmentType | ''
  transferFrom: TransferLine[]
  transferTo: TransferLine[]
}

export type FormErrors = Partial<Record<string, string>>
