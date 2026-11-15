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
  return (
    <>
      <DialogHeader>
        <DialogTitle>{login.reloginSlotId ? '重新登入' : '瀏覽器登入'}</DialogTitle>
        <DialogDescription className="text-pretty">
          請在剛開啟的瀏覽器視窗完成登入。登入完成後，這裡會自動繼續。
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3 text-sm" role="status">
        <Loader2 className="size-4 animate-spin" /> 等待登入中…
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => void act(window.api.copyLoginUrl(), '已複製登入網址')}>
          <Copy /> 複製登入網址
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </DialogFooter>
    </>
  )
}

function AwaitingName({ login, onCancel }: { login: LoginView; onCancel: () => void }): React.JSX.Element {
  const [name, setName] = useState(login.defaultName ?? login.email ?? '')
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    await act(window.api.completeLogin(name.trim()), '已儲存帳號')
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
        <DialogTitle>登入成功</DialogTitle>
        <DialogDescription>
          {login.email ? `已登入 ${login.email}，` : ''}請為這個帳號命名。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="login-name">帳號名稱</Label>
        <Input id="login-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy || !name.trim()}>
          儲存
        </Button>
      </DialogFooter>
    </form>
  )
}

function Failed({ login, onClose }: { login: LoginView; onClose: () => void }): React.JSX.Element {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TriangleAlert className="size-5 text-red-400" /> 登入失敗
        </DialogTitle>
        <DialogDescription className="text-pretty" role="alert">
          {login.message ?? '登入未完成，請再試一次。'}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={onClose}>關閉</Button>
      </DialogFooter>
    </>
  )
}
