import { useState } from 'react'
import { Copy, Loader2, TriangleAlert } from 'lucide-react'
import type { LoginView } from '../../../shared/types'
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
import { act } from '@/lib/use-app-state'
import { useT } from '@/lib/i18n'

export function LoginDialog({ login }: { login: LoginView }): React.JSX.Element {
  const open = login.state !== 'idle'
  const close = (): void => {
    void window.api.cancelLogin()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        {login.state === 'running' && <Running login={login} onCancel={close} />}
        {login.state === 'awaiting_name' && <AwaitingName login={login} onCancel={close} />}
        {login.state === 'failed' && <Failed login={login} onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}

function Running({ login, onCancel }: { login: LoginView; onCancel: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <>
      <DialogHeader>
        <DialogTitle>{login.reloginSlotId ? t('login.relogin') : t('login.browserLogin')}</DialogTitle>
        <DialogDescription className="text-pretty">
          {t('login.runningDesc')}
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" /> {t('login.waiting')}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => void act(window.api.copyLoginUrl(), t('login.urlCopied'))}>
          <Copy /> {t('login.copyUrl')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </DialogFooter>
    </>
  )
}

function AwaitingName({ login, onCancel }: { login: LoginView; onCancel: () => void }): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(login.defaultName ?? login.email ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    await act(window.api.completeLogin(name.trim()), t('dialog.accountSaved'))
    setBusy(false)
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('login.successTitle')}</DialogTitle>
        <DialogDescription>
          {login.email ? t('login.successDescWithEmail', { email: login.email }) : t('login.successDesc')}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="login-name">{t('dialog.accountName')}</Label>
        <Input id="login-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Failed({ login, onClose }: { login: LoginView; onClose: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-red-400" /> {t('login.failedTitle')}
        </DialogTitle>
        <DialogDescription className="text-pretty" role="alert">
          {login.message ?? t('login.failedDefault')}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogFooter>
    </>
  )
}
