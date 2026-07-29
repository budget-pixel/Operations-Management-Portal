import type { AmendmentType, AmendmentTypeOption } from '../../types/budgetTransfer'

const AMENDMENT_TYPE_OPTIONS: AmendmentTypeOption[] = [
  {
    value: 'intradepartmental',
    label: 'Intradepartmental Amendment',
    statute: 'Fl. St. 129.06(2)(a)',
    requires: 'Requires approval from County Administrator and Budget Officer.',
  },
  {
    value: 'interdepartmental',
    label: 'Interdepartmental Amendment',
    statute: 'Fl. St. 129.06(2)(b)',
    requires: 'Requires motion from BCC.',
  },
  {
    value: 'reserve',
    label: 'Reserve for future construction and improvements',
    statute: 'Fl. St. 129.06(2)(c)',
    requires: 'Requires Resolution by BCC.',
  },
  {
    value: 'unanticipatedRevenue',
    label: 'Unanticipated revenue',
    statute: 'Fl. St. 129.06(2)(d)',
    requires: 'Requires Resolution by BCC.',
  },
  {
    value: 'increasedReceipts',
    label: 'Increased receipts for enterprise fund',
    statute: 'Fl. St. 129.06(2)(e)',
    requires: 'Requires Resolution by BCC.',
  },
  {
    value: 'publicHearing',
    label: 'Requires Public Hearing',
    statute: 'Fl. St. 129.06(2)(f)',
    requires: '',
  },
]

interface AmendmentTypeSelectorProps {
  value: AmendmentType | ''
  onChange: (value: AmendmentType) => void
  error?: string
}

export function AmendmentTypeSelector({ value, onChange, error }: AmendmentTypeSelectorProps) {
  const errorId = 'amendmentType-error'

  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-sm font-medium text-slate-700">
        This request will require a<span className="ml-0.5 text-red-600">*</span>
      </legend>

      <div className="mt-2 space-y-2">
        {AMENDMENT_TYPE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
              value === option.value ? 'border-blue-700 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="amendmentType"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 h-4 w-4 border-slate-300 text-blue-800 focus:ring-blue-700"
            />
            <span>
              <span className="font-medium text-slate-800">{option.label}</span>{' '}
              <span className="text-slate-500">({option.statute})</span>
              {option.requires && <span className="block text-slate-500">{option.requires}</span>}
            </span>
          </label>
        ))}
      </div>

      {error && (
        <p id={errorId} className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  )
}
