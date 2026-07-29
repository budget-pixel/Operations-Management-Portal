import type { InputHTMLAttributes } from 'react'

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange'> {
  id: string
  label: string
  error?: string
  onChange: (value: string) => void
}

export function TextField({ id, label, error, required, onChange, className = '', ...rest }: TextFieldProps) {
  const errorId = `${id}-error`

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700 ${
          error ? 'border-red-400' : 'border-slate-300'
        }`}
        {...rest}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
