"""帳號 slot 管理、目前帳號判斷、切換。"""

from __future__ import annotations

import secrets
import time

from . import paths, storage


class AccountError(Exception):
    pass


def _slot_path(slot_id: str):
    return paths.slots_dir() / f"{slot_id}.json"


def list_slots() -> list[dict]:
    result = []
    d = paths.slots_dir()
    if d.is_dir():
        for p in d.glob("*.json"):
            data = storage.read_json(p, None)
            if isinstance(data, dict) and data.get("id"):
                result.append(data)
    result.sort(key=lambda s: (s.get("saved_at", 0), s.get("id", "")))
    return result


def get_slot(slot_id: str) -> dict | None:
    data = storage.read_json(_slot_path(slot_id), None)
    return data if isinstance(data, dict) else None


def update_slot(slot: dict) -> None:
    storage.write_json_atomic(_slot_path(slot["id"]), slot)


def current_account() -> dict | None:
    data = storage.read_json(paths.claude_json(), None)
    if not isinstance(data, dict):
        return None
    acct = data.get("oauthAccount")
    return acct if isinstance(acct, dict) else None


def match_slot(oauth_account: dict | None) -> dict | None:
    if not oauth_account:
        return None
    uuid = oauth_account.get("accountUuid")
    email = oauth_account.get("emailAddress")
    for s in list_slots():
        if uuid:
            if s.get("account_uuid") == uuid:
                return s
        elif email and s.get("email") == email:
            return s
    return None


def current_slot_id() -> str | None:
    s = match_slot(current_account())
    return s["id"] if s else None


def add_slot(name: str, credentials: dict, oauth_account: dict) -> dict:
    """新增或更新 slot（以 accountUuid／email 比對）。不碰 ~/.claude 的任何檔案。"""
    existing = match_slot(oauth_account)
    slot = {
        "id": existing["id"] if existing else secrets.token_hex(3),
        "name": name,
        "email": oauth_account.get("emailAddress", ""),
        "account_uuid": oauth_account.get("accountUuid", ""),
        "credentials": credentials,
        "oauth_account": oauth_account,
        "saved_at": time.time(),
        "exhausted_until": existing.get("exhausted_until", 0) if existing else 0,
    }
    update_slot(slot)
    return slot


def save_current(name: str) -> dict:
    creds = storage.read_json(paths.cred_file(), None)
    acct = current_account()
    if not isinstance(creds, dict) or not creds or not acct:
        raise AccountError("找不到目前登入的帳號，請先在 claude 中 /login")
    return add_slot(name, creds, acct)


def sync_current_back() -> bool:
    acct = current_account()
    slot = match_slot(acct)
    if not slot:
        return False
    creds = storage.read_json(paths.cred_file(), None)
    if not isinstance(creds, dict) or "claudeAiOauth" not in creds:
        return False
    if creds == slot.get("credentials"):
        return False
    slot["credentials"] = creds
    slot["oauth_account"] = acct
    update_slot(slot)
    return True


def switch_to(slot_id: str) -> None:
    slot = get_slot(slot_id)
    if not slot:
        raise AccountError("找不到指定的帳號")
    sync_current_back()
    # 同步可能更新了目標 slot（目標即目前帳號時），重讀
    slot = get_slot(slot_id) or slot
    storage.write_json_atomic(paths.cred_file(), slot["credentials"])
    cj = paths.claude_json()
    if cj.exists():
        data = storage.read_json_strict(cj)
        if isinstance(data, dict):
            data["oauthAccount"] = slot["oauth_account"]
            storage.write_json_atomic(cj, data)
    if storage.read_json(paths.cred_file(), None) != slot["credentials"]:
        raise AccountError("切換後驗證失敗：憑證內容與帳號不一致")
    storage.write_json_atomic(paths.active_file(), {"switched_at": time.time()})


def delete_slot(slot_id: str) -> None:
    if slot_id == current_slot_id():
        raise AccountError("無法刪除使用中的帳號")
    try:
        _slot_path(slot_id).unlink()
    except FileNotFoundError:
        pass


def mark_exhausted(slot_id: str, until_ts: float) -> None:
    slot = get_slot(slot_id)
    if slot:
        slot["exhausted_until"] = until_ts
        update_slot(slot)


def clear_exhausted(slot_id: str) -> None:
    mark_exhausted(slot_id, 0)
