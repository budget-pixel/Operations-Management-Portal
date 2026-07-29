import { Landmark } from 'lucide-react'

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-6 sm:px-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-800 text-white">
          <Landmark className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
            Office of Management and Budget
          </p>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Budget Amendment Request</h1>
        </div>
      </div>
    </header>
  )
}
