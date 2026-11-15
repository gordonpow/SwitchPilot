"""tkinter 介面：帳號清單、用量、啟動、自動切換、整合、事件紀錄。"""

from __future__ import annotations

import time
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from . import accounts, config, integration, launcher, login, paths, storage, switchplan, usage
from .monitor import Action, Monitor
from .procutil import pid_alive

POLL_MS = 3000
WAIT_MS = 500
WAIT_MAX_S = 10.0
CLEANUP_EVERY_S = 600.0
STALE_S = 600.0
LOGIN_POLL_MS = 1000
LOGIN_TIMEOUT_S = 300.0


def fmt_ts(ts) -> str:
    """Unix 秒 → 本地時間 MM/DD HH:MM。"""
    try:
        return time.strftime("%m/%d %H:%M", time.localtime(float(ts)))
    except (TypeError, ValueError, OSError, OverflowError):
        return "--"


def decide(monitor: Monitor, now: float, current_id, usage_rec, events,
           auto_on: bool) -> Action:
    """tick 的決策部分（不依賴 Tk）：自動切換關閉或無目前帳號時一律不動作。"""
    if not auto_on or not current_id:
        return Action("none")
    return monitor.tick(now, current_id, usage_rec, events)


def slot_status(slot: dict, current_id, now: float) -> str:
    if slot.get("id") == current_id:
        return "使用中"
    until = slot.get("exhausted_until") or 0
    if until > now:
        return f"用完，{fmt_ts(until)} 重置"
    return "可用"


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("Claude 帳號切換器")
        root.minsize(720, 600)
        self.cfg = config.load()
        self.monitor = Monitor(threshold=float(self.cfg.get("threshold", 95)))
        self.switching = False
        self.pending_logged = False
        self.warned_exhaust = False
        self.last_cleanup = 0.0
        self.login_session = None
        self.login_win = None
        self.login_started = 0.0
        try:
            login.cleanup_stale()
        except Exception:  # noqa: BLE001
            pass
        _, self.watermark = usage.read_new_events(None)
        self._build()
        self.refresh()
        self.log("已啟動。提醒：非本程式啟動的 claude 不會切換，切換前請先關閉。")
        root.after(POLL_MS, self.tick)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

    # ---------- 介面 ----------
    def _build(self) -> None:
        main = ttk.Frame(self.root, padding=10)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=1)
        main.rowconfigure(5, weight=1)

        # 1. 帳號
        f = ttk.LabelFrame(main, text="帳號", padding=8)
        f.grid(row=0, column=0, sticky="ew", pady=4)
        f.columnconfigure(0, weight=1)
        self.tree = ttk.Treeview(f, columns=("name", "email", "status"),
                                 show="headings", height=5, selectmode="browse")
        for col, text, w in (("name", "名稱", 140), ("email", "Email", 260),
                             ("status", "狀態", 200)):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=w, anchor="w")
        self.tree.grid(row=0, column=0, sticky="ew")
        self.unsaved_var = tk.StringVar()
        ttk.Label(f, textvariable=self.unsaved_var, foreground="#b00020").grid(
            row=1, column=0, sticky="w", pady=(4, 0))
        bf = ttk.Frame(f)
        bf.grid(row=2, column=0, sticky="w", pady=(6, 0))
        for text, cmd in (("新增帳號（瀏覽器登入）", self.on_add_browser),
                          ("儲存目前登入的帳號", self.on_save),
                          ("切換到選取帳號", self.on_switch),
                          ("刪除", self.on_delete),
                          ("重新整理", self.refresh)):
            ttk.Button(bf, text=text, command=cmd).pack(side="left", padx=(0, 6))

        # 2. 用量
        f = ttk.LabelFrame(main, text="用量（目前帳號）", padding=8)
        f.grid(row=1, column=0, sticky="ew", pady=4)
        f.columnconfigure(1, weight=1)
        self.bars = {}
        for i, (key, label) in enumerate((("five_hour", "5 小時"), ("seven_day", "7 天"))):
            ttk.Label(f, text=label, width=8).grid(row=i, column=0, sticky="w", pady=2)
            pb = ttk.Progressbar(f, maximum=100, mode="determinate")
            pb.grid(row=i, column=1, sticky="ew", padx=6)
            var = tk.StringVar(value="--")
            ttk.Label(f, textvariable=var, width=26).grid(row=i, column=2, sticky="w")
            self.bars[key] = (pb, var)
        self.usage_note = tk.StringVar()
        ttk.Label(f, textvariable=self.usage_note, foreground="#666666").grid(
            row=2, column=0, columnspan=3, sticky="w")

        # 3. 啟動
        f = ttk.LabelFrame(main, text="啟動", padding=8)
        f.grid(row=2, column=0, sticky="ew", pady=4)
        f.columnconfigure(0, weight=1)
        self.folder_var = tk.StringVar(value=self.cfg.get("last_folder", ""))
        ttk.Entry(f, textvariable=self.folder_var).grid(row=0, column=0, sticky="ew")
        ttk.Button(f, text="瀏覽", command=self.on_browse).grid(row=0, column=1, padx=6)
        ttk.Button(f, text="啟動 claude", command=lambda: self.on_launch(False)).grid(
            row=0, column=2, padx=(0, 6))
        ttk.Button(f, text="啟動（--continue）",
                   command=lambda: self.on_launch(True)).grid(row=0, column=3)
        self.runs_var = tk.StringVar(value="託管中的視窗：0")
        ttk.Label(f, textvariable=self.runs_var).grid(row=1, column=0, sticky="w", pady=(4, 0))

        # 4. 自動切換
        f = ttk.LabelFrame(main, text="自動切換", padding=8)
        f.grid(row=3, column=0, sticky="ew", pady=4)
        self.auto_var = tk.BooleanVar(value=bool(self.cfg.get("auto_switch", True)))
        ttk.Checkbutton(f, text="額度用完自動切換", variable=self.auto_var,
                        command=self.on_setting).pack(side="left")
        ttk.Label(f, text="門檻 (%)").pack(side="left", padx=(16, 4))
        self.thr_var = tk.StringVar(value=str(int(float(self.cfg.get("threshold", 95)))))
        self.thr_spin = ttk.Spinbox(f, from_=50, to=100, width=5, textvariable=self.thr_var,
                                    command=self.on_setting)
        self.thr_spin.pack(side="left")
        self.thr_spin.bind("<FocusOut>", lambda e: self.on_setting())
        self.thr_spin.bind("<Return>", lambda e: self.on_setting())

        # 5. 整合
        f = ttk.LabelFrame(main, text="整合（statusline 與 hook）", padding=8)
        f.grid(row=4, column=0, sticky="ew", pady=4)
        self.integ_var = tk.StringVar()
        ttk.Label(f, textvariable=self.integ_var, width=12).pack(side="left")
        ttk.Button(f, text="安裝整合", command=self.on_install).pack(side="left", padx=6)
        ttk.Button(f, text="移除整合", command=self.on_uninstall).pack(side="left")

        # 6. 事件紀錄
        f = ttk.LabelFrame(main, text="事件紀錄", padding=8)
        f.grid(row=5, column=0, sticky="nsew", pady=4)
        f.columnconfigure(0, weight=1)
        f.rowconfigure(0, weight=1)
        self.text = tk.Text(f, height=8, state="disabled", wrap="word")
        sb = ttk.Scrollbar(f, command=self.text.yview)
        self.text.configure(yscrollcommand=sb.set)
        self.text.grid(row=0, column=0, sticky="nsew")
        sb.grid(row=0, column=1, sticky="ns")

    # ---------- 工具 ----------
    def log(self, msg: str) -> None:
        self.text.configure(state="normal")
        self.text.insert("end", time.strftime("%H:%M:%S") + " " + msg + "\n")
        self.text.see("end")
        self.text.configure(state="disabled")

    def error(self, where: str, exc: Exception) -> None:
        self.log(f"錯誤（{where}）：{exc}")
        messagebox.showerror("錯誤", f"{where}失敗：\n{exc}")

    def selected_id(self):
        sel = self.tree.selection()
        return sel[0] if sel else None

    def slot_name(self, slot_id) -> str:
        s = accounts.get_slot(slot_id) if slot_id else None
        return (s or {}).get("name") or (slot_id or "未儲存")

    # ---------- 畫面更新 ----------
    def refresh(self) -> None:
        try:
            now = time.time()
            current = accounts.current_slot_id()
            acct = accounts.current_account()
            keep = self.selected_id()
            self.tree.delete(*self.tree.get_children())
            for s in accounts.list_slots():
                self.tree.insert("", "end", iid=s["id"],
                                 values=(s.get("name", ""), s.get("email", ""),
                                         slot_status(s, current, now)))
            if keep and self.tree.exists(keep):
                self.tree.selection_set(keep)
            if acct is None:
                self.unsaved_var.set("目前沒有登入帳號（請先在 claude 中 /login）")
            elif current is None:
                self.unsaved_var.set("目前登入的帳號尚未儲存")
            else:
                self.unsaved_var.set("")
            self.integ_var.set("已安裝" if integration.is_installed() else "未安裝")
            self.refresh_usage(current, now)
            self.runs_var.set(f"託管中的視窗：{len(launcher.active_runs())}")
        except Exception as e:  # noqa: BLE001
            self.log(f"錯誤（重新整理）：{e}")

    def refresh_usage(self, current, now: float) -> None:
        rec = usage.latest_usage(current, since=self.monitor.since) if current else None
        for key, (pb, var) in self.bars.items():
            w = rec.get(key) if rec else None
            if isinstance(w, dict) and w.get("used_percentage") is not None:
                pct = float(w["used_percentage"])
                pb["value"] = pct
                var.set(f"{pct:.0f}%，{fmt_ts(w.get('resets_at'))} 重置")
            else:
                pb["value"] = 0
                var.set("--")
        if not current:
            self.usage_note.set("目前帳號未儲存，無用量資料")
        elif rec is None:
            self.usage_note.set("尚無用量資料（請安裝整合並在 claude 中至少對話一次）")
        elif usage.is_stale(rec, now, STALE_S):
            self.usage_note.set(f"資料過舊（最後更新 {fmt_ts(rec.get('ts'))}）")
        else:
            self.usage_note.set(f"最後更新 {fmt_ts(rec.get('ts'))}")

    # ---------- 輪詢 ----------
    def tick(self) -> None:
        try:
            self._tick()
        except Exception as e:  # noqa: BLE001
            self.log(f"錯誤（輪詢）：{e}")
        finally:
            self.root.after(POLL_MS, self.tick)

    def _tick(self) -> None:
        now = time.time()
        if self.switching:
            self.refresh()
            return
        accounts.sync_current_back()
        current = accounts.current_slot_id()
        rec = usage.latest_usage(current, since=self.monitor.since) if current else None
        events, self.watermark = usage.read_new_events(self.watermark)
        action = decide(self.monitor, now, current, rec, events, self.auto_var.get())
        if action.kind == "pending":
            if not self.pending_logged:
                self.pending_logged = True
                self.log("已達門檻，等待回合結束後切換")
        else:
            self.pending_logged = False
        if now - self.last_cleanup > CLEANUP_EVERY_S:
            self.last_cleanup = now
            usage.cleanup(now)
        self.refresh()
        if action.kind == "switch_now":
            self.start_switch(None, action.reason, action.exhausted_until, auto=True)

    # ---------- 設定 ----------
    def on_setting(self) -> None:
        try:
            try:
                thr = float(self.thr_var.get())
            except ValueError:
                thr = 95.0
            thr = min(100.0, max(50.0, thr))
            self.thr_var.set(str(int(thr)))
            self.monitor.threshold = thr
            self.cfg["threshold"] = thr
            self.cfg["auto_switch"] = bool(self.auto_var.get())
            self.cfg["last_folder"] = self.folder_var.get()
            config.save(self.cfg)
        except Exception as e:  # noqa: BLE001
            self.error("儲存設定", e)

    # ---------- 帳號操作 ----------
    def on_save(self) -> None:
        try:
            name = simpledialog.askstring("儲存帳號", "請輸入這個帳號的名稱：", parent=self.root)
            if not name or not name.strip():
                return
            s = accounts.save_current(name.strip())
            self.log(f"已儲存帳號：{s['name']}（{s['email']}）")
            self.refresh()
        except Exception as e:  # noqa: BLE001
            self.error("儲存帳號", e)

    # ---------- 瀏覽器登入 ----------
    def on_add_browser(self) -> None:
        if self.login_session is not None:
            return
        session = login.LoginSession()
        try:
            session.start()
        except Exception as e:  # noqa: BLE001
            session.cleanup()
            self.error("新增帳號（瀏覽器登入）", e)
            return
        self.login_session = session
        self.login_started = time.time()
        self.log("已開始瀏覽器登入")
        win = tk.Toplevel(self.root)
        win.title("瀏覽器登入")
        win.transient(self.root)
        win.resizable(False, False)
        ttk.Label(win, padding=12, wraplength=360, justify="left",
                  text="已開啟 Edge InPrivate 視窗，請在瀏覽器中登入（可選 Google）。"
                       "完成後此視窗會自動關閉。").pack()
        bf = ttk.Frame(win, padding=(12, 0, 12, 12))
        bf.pack()
        ttk.Button(bf, text="複製登入網址", command=self.on_copy_login_url).pack(
            side="left", padx=(0, 6))
        ttk.Button(bf, text="取消", command=self.on_login_cancel).pack(side="left")
        win.protocol("WM_DELETE_WINDOW", self.on_login_cancel)
        self.login_win = win
        self.root.after(LOGIN_POLL_MS, lambda: self._poll_login(session))

    def on_copy_login_url(self) -> None:
        url = self.login_session.login_url() if self.login_session else None
        if not url:
            messagebox.showinfo("複製登入網址", "登入網址尚未準備好，請稍候再試",
                                parent=self.login_win or self.root)
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        self.log("已複製登入網址")

    def _close_login_win(self) -> None:
        win, self.login_win = self.login_win, None
        if win is not None:
            try:
                win.destroy()
            except Exception:  # noqa: BLE001
                pass

    def on_login_cancel(self) -> None:
        session, self.login_session = self.login_session, None
        if session is not None:
            session.cancel()
            self.log("已取消瀏覽器登入")
        self._close_login_win()

    def _finish_login(self, session) -> None:
        """結束登入流程：清暫存、關視窗（只能呼叫一次）。"""
        session.cleanup()
        if self.login_session is session:
            self.login_session = None
        self._close_login_win()

    def _poll_login(self, session) -> None:
        if self.login_session is not session:
            return
        try:
            state = session.poll()
            if state == "running":
                if time.time() - self.login_started > LOGIN_TIMEOUT_S:
                    self.login_session = None
                    session.cancel()
                    self._close_login_win()
                    self.log("登入逾時")
                    messagebox.showwarning("瀏覽器登入", "登入逾時（超過 5 分鐘），已取消")
                    return
                self.root.after(LOGIN_POLL_MS, lambda: self._poll_login(session))
                return
            if state == "failed":
                lines = session.last_lines(5)
                self.log("登入失敗：" + (" / ".join(lines) if lines else "（無輸出）"))
                self._finish_login(session)
                messagebox.showerror("瀏覽器登入", "登入失敗：\n" + "\n".join(lines))
                return
            self._complete_login(session)
        except Exception as e:  # noqa: BLE001
            self._finish_login(session)
            self.error("瀏覽器登入", e)

    def _complete_login(self, session) -> None:
        try:
            creds, acct = session.result()
        except login.LoginError as e:
            self._finish_login(session)
            self.error("瀏覽器登入", e)
            return
        email = acct.get("emailAddress", "")
        self._close_login_win()
        name = simpledialog.askstring("帳號名稱", "請輸入這個帳號的名稱：",
                                      initialvalue=email, parent=self.root)
        name = (name or "").strip() or email or "新帳號"
        try:
            slot = accounts.add_slot(name, creds, acct)
            if slot["id"] == accounts.current_slot_id():
                storage.write_json_atomic(paths.cred_file(), creds)
                self.log("登入的是目前使用中的帳號，已更新憑證；"
                         "執行中的 claude 若出現 Login expired 請重開")
            self.log(f"已新增帳號 {name}（{email}）")
        finally:
            self._finish_login(session)
        self.refresh()

    def on_close(self) -> None:
        session, self.login_session = self.login_session, None
        if session is not None:
            try:
                session.cancel()
            except Exception:  # noqa: BLE001
                pass
        self.root.destroy()

    def on_delete(self) -> None:
        try:
            sid = self.selected_id()
            if not sid:
                messagebox.showinfo("刪除", "請先選取一個帳號")
                return
            name = self.slot_name(sid)
            if not messagebox.askyesno("刪除帳號", f"確定刪除「{name}」？"):
                return
            accounts.delete_slot(sid)
            self.log(f"已刪除帳號：{name}")
            self.refresh()
        except Exception as e:  # noqa: BLE001
            self.error("刪除帳號", e)

    def on_switch(self) -> None:
        try:
            sid = self.selected_id()
            if not sid:
                messagebox.showinfo("切換", "請先選取一個帳號")
                return
            if self.switching:
                messagebox.showinfo("切換", "正在切換中，請稍候")
                return
            current = accounts.current_slot_id()
            if sid == current:
                messagebox.showinfo("切換", "這已經是使用中的帳號")
                return
            self.log("提醒：非本程式啟動的 claude 不會切換")
            runs = launcher.active_runs()
            if runs and messagebox.askyesno(
                    "切換",
                    f"有 {len(runs)} 個託管中的 claude 視窗，是否一併重啟（--continue）？\n"
                    "選「否」只會換帳號，已開啟的 claude 不會改用新帳號。"):
                self.start_switch(sid, "手動切換", None, auto=False)
            else:
                accounts.switch_to(sid)
                self.monitor.reset(time.time())
                self.log(f"切換：{self.slot_name(current)} → {self.slot_name(sid)}（手動）")
                self.refresh()
        except Exception as e:  # noqa: BLE001
            self.error("切換帳號", e)

    # ---------- 切換流程 ----------
    def start_switch(self, target, reason: str, exhausted_until, auto: bool) -> None:
        if self.switching:
            return
        self.switching = True
        try:
            now = time.time()
            current = accounts.current_slot_id()
            if auto:
                if current and exhausted_until:
                    accounts.mark_exhausted(current, exhausted_until)
                slots = accounts.list_slots()
                nxt = switchplan.pick_next(slots, current, now)
                if nxt is None:
                    self.log("所有帳號都已用完，不切換")
                    if not self.warned_exhaust:
                        self.warned_exhaust = True
                        er = switchplan.earliest_reset(slots, now)
                        messagebox.showwarning(
                            "所有帳號都已用完",
                            "沒有可切換的帳號。\n最早重置時間："
                            + (fmt_ts(er) if er else "未知"))
                    self.monitor.reset(now)
                    self.switching = False
                    self.refresh()
                    return
                target = nxt["id"]
            runs = launcher.active_runs()
            for r in runs:
                launcher.request_restart(r)
            self.refresh()
            self._wait_claude(runs, target, current, reason, time.time())
        except Exception as e:  # noqa: BLE001
            self.switching = False
            self.error("切換", e)

    def _wait_claude(self, runs, target, current, reason, started) -> None:
        try:
            alive = [r for r in runs if r.get("claude_pid") and pid_alive(r["claude_pid"])]
            if alive and time.time() - started < WAIT_MAX_S:
                self.root.after(WAIT_MS, lambda: self._wait_claude(
                    runs, target, current, reason, started))
                return
            if alive:
                self._abort_runs(runs)
                self.log("切換中止：claude 未結束")
                self.switching = False
                return
            try:
                accounts.switch_to(target)
            except Exception as e:  # noqa: BLE001
                self._abort_runs(runs)
                self.switching = False
                self.error("切換帳號", e)
                return
            self.monitor.reset(time.time())
            self.pending_logged = False
            for r in runs:
                launcher.release_restart(r)
            self.warned_exhaust = False
            self.log(f"切換：{self.slot_name(current)} → {self.slot_name(target)}（{reason}）")
            self.switching = False
            self.refresh()
        except Exception as e:  # noqa: BLE001
            self.switching = False
            self.error("切換", e)

    def _abort_runs(self, runs) -> None:
        for r in runs:
            try:
                launcher.abort_restart(r)
            except Exception as e:  # noqa: BLE001
                self.log(f"錯誤（中止重啟）：{e}")

    # ---------- 啟動 ----------
    def on_browse(self) -> None:
        d = filedialog.askdirectory(initialdir=self.folder_var.get() or None)
        if d:
            self.folder_var.set(d.replace("/", "\\"))
            self.on_setting()

    def on_launch(self, cont: bool) -> None:
        try:
            folder = self.folder_var.get().strip()
            if not folder:
                messagebox.showinfo("啟動", "請先選擇專案資料夾")
                return
            self.on_setting()
            launcher.launch(folder, cont=cont)
            self.log(f"已啟動 claude：{folder}" + ("（--continue）" if cont else ""))
        except Exception as e:  # noqa: BLE001
            self.error("啟動 claude", e)

    # ---------- 整合 ----------
    def on_install(self) -> None:
        try:
            integration.install()
            self.log("已安裝整合（備份在 backups 資料夾）。已開啟的 claude 需重開才會生效")
            self.refresh()
        except Exception as e:  # noqa: BLE001
            self.error("安裝整合", e)

    def on_uninstall(self) -> None:
        try:
            integration.uninstall()
            self.log("已移除整合")
            self.refresh()
        except Exception as e:  # noqa: BLE001
            self.error("移除整合", e)


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()
