import { Printer, RotateCcw, Save, Send } from 'lucide-react'
import { Button } from '../ui/Button'

interface FormActionsProps {
  onReset: () => void
  onPrint: () => void
  onSaveDraft: () => void
}

export function FormActions({ onReset, onPrint, onSaveDraft }: FormActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <Button type="submit" variant="primary" icon={<Send className="h-4 w-4" />}>
        Submit Request
      </Button>
      <Button type="button" variant="secondary" icon={<Save className="h-4 w-4" />} onClick={onSaveDraft}>
        Save Draft
      </Button>
      <Button type="button" variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={onPrint}>
        Print
      </Button>
      <Button type="button" variant="danger" icon={<RotateCcw className="h-4 w-4" />} onClick={onReset}>
        Reset
      </Button>
    </div>
  )
}
