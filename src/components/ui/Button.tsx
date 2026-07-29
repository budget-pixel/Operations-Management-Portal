import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  children: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-blue-800 text-white hover:bg-blue-900 focus-visible:outline-blue-800',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 focus-visible:outline-red-600',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:outline-slate-400',
}

export function Button({ variant = 'secondary', icon, children, className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
