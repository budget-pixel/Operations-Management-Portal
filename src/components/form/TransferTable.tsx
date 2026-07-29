import { Plus, Trash2 } from 'lucide-react'
import type { FormErrors, TransferLine } from '../../types/budgetTransfer'
import { formatCurrency } from '../../utils/currency'
import { Button } from '../ui/Button'

export type TransferField = 'accountNumber' | 'amount'

interface TransferTableProps {
  title: string
  section: 'transferFrom' | 'transferTo'
  lines: TransferLine[]
  errors: FormErrors
  total: number
  onLineChange: (id: string, field: TransferField, value: string) => void
  onAddRow: () => void
  onRemoveRow: (id: string) => void
}

export function TransferTable({
  title,
  section,
  lines,
  errors,
  total,
  onLineChange,
  onAddRow,
  onRemoveRow,
}: TransferTableProps) {
  const rowError = errors[section]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>

      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-x-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>Account Number</span>
        <span>Amount</span>
        <span className="print:hidden" aria-hidden="true" />
      </div>

      <div className="mt-1 space-y-2">
        {lines.map((line, index) => {
          const accountError = errors[`${section}.${index}.accountNumber`]
          const amountError = errors[`${section}.${index}.amount`]
          return (
            <div key={line.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-x-3 gap-y-1">
              <div>
                <label className="sr-only" htmlFor={`${section}-${line.id}-account`}>
                  Account number, row {index + 1}
                </label>
                <input
                  id={`${section}-${line.id}-account`}
                  value={line.accountNumber}
                  onChange={(event) => onLineChange(line.id, 'accountNumber', event.target.value)}
                  placeholder="e.g. 001-1234-541"
                  aria-invalid={Boolean(accountError)}
                  className={`block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700 ${
                    accountError ? 'border-red-400' : 'border-slate-300'
                  }`}
                />
                {accountError && <p className="mt-1 text-xs text-red-600">{accountError}</p>}
              </div>
              <div>
                <label className="sr-only" htmlFor={`${section}-${line.id}-amount`}>
                  Amount, row {index + 1}
                </label>
                <input
                  id={`${section}-${line.id}-amount`}
                  value={line.amount}
                  onChange={(event) => onLineChange(line.id, 'amount', event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-invalid={Boolean(amountError)}
                  className={`block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700 ${
                    amountError ? 'border-red-400' : 'border-slate-300'
                  }`}
                />
                {amountError && <p className="mt-1 text-xs text-red-600">{amountError}</p>}
              </div>
              <button
                type="button"
                onClick={() => onRemoveRow(line.id)}
                disabled={lines.length <= 1}
                aria-label={`Remove row ${index + 1}`}
                className="mt-1 rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 print:hidden"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>

      {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}

      <Button variant="ghost" className="mt-3 print:hidden" icon={<Plus className="h-4 w-4" />} onClick={onAddRow}>
        Add Row
      </Button>

      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="text-sm font-semibold text-slate-700">Total</span>
        <span className="text-base font-semibold text-slate-900">{formatCurrency(total)}</span>
      </div>
    </div>
  )
}
