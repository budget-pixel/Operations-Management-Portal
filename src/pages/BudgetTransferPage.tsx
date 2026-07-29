import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, FileWarning } from 'lucide-react'
import { Header } from '../components/layout/Header'
import { TextField } from '../components/ui/TextField'
import { TextAreaField } from '../components/ui/TextAreaField'
import { AmendmentTypeSelector } from '../components/form/AmendmentTypeSelector'
import { TransferTable, type TransferField } from '../components/form/TransferTable'
import { FormActions } from '../components/form/FormActions'
import { Button } from '../components/ui/Button'
import { useBudgetTransferForm } from '../hooks/useBudgetTransferForm'
import { useLocalDraft } from '../hooks/useLocalDraft'
import type { TransferSection } from '../hooks/useBudgetTransferForm'
import type { AmendmentType } from '../types/budgetTransfer'

export function BudgetTransferPage() {
  const {
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
  } = useBudgetTransferForm()

  const draft = useLocalDraft()
  const [showDraftBanner, setShowDraftBanner] = useState(false)
  const [draftMessage, setDraftMessage] = useState<string | null>(null)

  useEffect(() => {
    if (draft.draftAvailable) {
      setShowDraftBanner(true)
    }
    // Runs once on mount to check for a previously saved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submit()
  }

  function handleReset() {
    const confirmed = window.confirm('Reset the form? Any unsaved changes will be lost.')
    if (confirmed) {
      resetForm()
      setDraftMessage(null)
    }
  }

  function handlePrint() {
    window.print()
  }

  function handleSaveDraft() {
    draft.save(formData)
    setDraftMessage(`Draft saved at ${new Date().toLocaleTimeString()}`)
  }

  function handleRestoreDraft() {
    const saved = draft.load()
    if (saved) {
      loadFormData(saved)
    }
    setShowDraftBanner(false)
  }

  function handleDiscardDraft() {
    draft.clear()
    setShowDraftBanner(false)
  }

  function handleTransferLineChange(section: TransferSection) {
    return (id: string, field: TransferField, value: string) => updateTransferLine(section, id, field, value)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="hidden text-xl font-bold text-slate-900 print:block">Budget Amendment Request</h2>

        {showDraftBanner && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
            <span className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 shrink-0" />
              A saved draft was found. Restore it?
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" onClick={handleRestoreDraft}>
                Restore
              </Button>
              <Button variant="ghost" onClick={handleDiscardDraft}>
                Discard
              </Button>
            </span>
          </div>
        )}

        {draftMessage && (
          <div className="mb-6 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 print:hidden">
            {draftMessage}
          </div>
        )}

        {isSubmitted && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 print:hidden">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Request validated and ready for submission. Use Print to generate a copy for signatures.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="date"
                label="Date"
                type="date"
                required
                value={formData.date}
                onChange={(value) => updateField('date', value)}
                error={errors.date}
              />
              <TextField
                id="department"
                label="Department"
                required
                value={formData.department}
                onChange={(value) => updateField('department', value)}
                error={errors.department}
                placeholder="e.g. Public Works"
              />
            </div>

            <TextAreaField
              id="description"
              label="Information concerning the following budget amendment request"
              className="mt-4"
              value={formData.description}
              onChange={(value) => updateField('description', value)}
              placeholder="Describe the purpose of this budget amendment..."
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField
                id="preparedBy"
                label="Prepared By"
                required
                value={formData.preparedBy}
                onChange={(value) => updateField('preparedBy', value)}
                error={errors.preparedBy}
              />
              <TextField
                id="title"
                label="Title"
                required
                value={formData.title}
                onChange={(value) => updateField('title', value)}
                error={errors.title}
              />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
            <AmendmentTypeSelector
              value={formData.amendmentType}
              onChange={(value: AmendmentType) => updateField('amendmentType', value)}
              error={errors.amendmentType}
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <TransferTable
              title="Transfer From"
              section="transferFrom"
              lines={formData.transferFrom}
              errors={errors}
              total={fromTotal}
              onLineChange={handleTransferLineChange('transferFrom')}
              onAddRow={() => addTransferLine('transferFrom')}
              onRemoveRow={(id) => removeTransferLine('transferFrom', id)}
            />
            <TransferTable
              title="Transfer To"
              section="transferTo"
              lines={formData.transferTo}
              errors={errors}
              total={toTotal}
              onLineChange={handleTransferLineChange('transferTo')}
              onAddRow={() => addTransferLine('transferTo')}
              onRemoveRow={(id) => removeTransferLine('transferTo', id)}
            />
          </section>

          <FormActions onReset={handleReset} onPrint={handlePrint} onSaveDraft={handleSaveDraft} />
        </form>
      </main>
    </div>
  )
}
