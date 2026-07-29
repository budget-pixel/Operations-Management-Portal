const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function parseAmount(value: string): number {
  const numeric = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(numeric) ? numeric : 0
}

export function isValidAmount(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  const numeric = Number(trimmed.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(numeric) && numeric > 0
}

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

export function sumAmounts(values: string[]): number {
  return values.reduce((total, value) => total + parseAmount(value), 0)
}
