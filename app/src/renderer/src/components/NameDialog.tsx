import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'

interface Props {
  open: boolean
  title: string
  description?: string
  initialName: string
  submitLabel: string
  onSubmit: (name: string) => Promise<void> | void
  onClose: () => void
}

/** 重新命名、儲存目前帳號共用的名稱輸入 Dialog。 */
export function NameDialog({ open, ...rest }: Props): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && rest.onClose()}>
      <DialogContent className="sm:max-w-sm">{open && <Body {...rest} />}</DialogContent>
    </Dialog>
  )
}

function Body({ title, description, initialName, submitLabel, onSubmit, onClose }: Omit<Props, 'open'>): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    await onSubmit(name.trim())
    setBusy(false)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="name-input">{t('dialog.accountName')}</Label>
        <Input id="name-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
