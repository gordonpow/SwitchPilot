import json
import os
import tempfile
import unittest
from pathlib import Path

from switcher import accounts, config, paths, storage

ENV_KEYS = ["CLAUDE_SWITCHER_HOME", "CLAUDE_SWITCHER_CLAUDE_HOME", "CLAUDE_SWITCHER_CLAUDE_JSON"]


def creds(token):
    return {"claudeAiOauth": {"accessToken": token, "refreshToken": "r-" + token}}


def acct(uuid, email):
    return {"accountUuid": uuid, "emailAddress": email}


class Base(unittest.TestCase):
    def setUp(self):
        self._old = {k: os.environ.get(k) for k in ENV_KEYS}
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        os.environ["CLAUDE_SWITCHER_HOME"] = str(root / "app")
        os.environ["CLAUDE_SWITCHER_CLAUDE_HOME"] = str(root / "claude")
        os.environ["CLAUDE_SWITCHER_CLAUDE_JSON"] = str(root / "claude.json")

    def tearDown(self):
        for k, v in self._old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def login(self, token, uuid, email, extra=None):
        storage.write_json_atomic(paths.cred_file(), creds(token))
        data = {"oauthAccount": acct(uuid, email)}
        data.update(extra or {})
        storage.write_json_atomic(paths.claude_json(), data)


class AccountsTest(Base):
    def test_save_new(self):
        self.login("t1", "u1", "a@x")
        s = accounts.save_current("主帳號")
        self.assertEqual(s["email"], "a@x")
        self.assertEqual(len(accounts.list_slots()), 1)
        self.assertEqual(accounts.current_slot_id(), s["id"])

    def test_same_uuid_updates(self):
        self.login("t1", "u1", "a@x")
        s1 = accounts.save_current("A")
        accounts.mark_exhausted(s1["id"], 123)
        self.login("t2", "u1", "a@x")
        s2 = accounts.save_current("A2")
        self.assertEqual(s1["id"], s2["id"])
        self.assertEqual(len(accounts.list_slots()), 1)
        self.assertEqual(s2["credentials"], creds("t2"))
        self.assertEqual(s2["exhausted_until"], 123)

    def test_match_by_email_without_uuid(self):
        self.login("t1", "", "a@x")
        s1 = accounts.save_current("A")
        s2 = accounts.save_current("A again")
        self.assertEqual(s1["id"], s2["id"])
        self.assertEqual(accounts.current_slot_id(), s1["id"])

    def test_add_slot_new_and_update(self):
        self.login("cur", "u0", "cur@x")
        before = storage.read_json(paths.cred_file())
        s1 = accounts.add_slot("新", creds("n1"), acct("u9", "n@x"))
        self.assertEqual(s1["email"], "n@x")
        self.assertEqual(accounts.get_slot(s1["id"])["credentials"], creds("n1"))
        accounts.mark_exhausted(s1["id"], 55)
        s2 = accounts.add_slot("新2", creds("n2"), acct("u9", "n@x"))
        self.assertEqual(s1["id"], s2["id"])
        self.assertEqual(s2["exhausted_until"], 55)
        self.assertEqual(len(accounts.list_slots()), 1)
        # 不碰目前的憑證與 claude.json
        self.assertEqual(storage.read_json(paths.cred_file()), before)
        self.assertEqual(accounts.current_account()["accountUuid"], "u0")

    def test_not_logged_in(self):
        with self.assertRaises(accounts.AccountError):
            accounts.save_current("x")
        storage.write_json_atomic(paths.cred_file(), creds("t"))
        with self.assertRaises(accounts.AccountError):
            accounts.save_current("x")

    def test_switch_syncs_back_then_replaces(self):
        self.login("t1", "u1", "a@x", {"numStartups": 7, "projects": {"p": 1}})
        a = accounts.save_current("A")
        self.login("t1", "u2", "b@x", {"numStartups": 7, "projects": {"p": 1}})
        b = accounts.save_current("B")
        # 目前是 B，且 token 被 claude 更新
        storage.write_json_atomic(paths.cred_file(), creds("t2-refreshed"))
        accounts.switch_to(a["id"])
        self.assertEqual(accounts.get_slot(b["id"])["credentials"], creds("t2-refreshed"))
        self.assertEqual(storage.read_json(paths.cred_file()), creds("t1"))
        cj = storage.read_json(paths.claude_json())
        self.assertEqual(cj["oauthAccount"]["accountUuid"], "u1")
        self.assertEqual(cj["numStartups"], 7)
        self.assertEqual(cj["projects"], {"p": 1})
        self.assertEqual(accounts.current_slot_id(), a["id"])
        self.assertIn("switched_at", storage.read_json(paths.active_file()))

    def test_switch_without_claude_json(self):
        self.login("t1", "u1", "a@x")
        a = accounts.save_current("A")
        os.remove(paths.claude_json())
        accounts.switch_to(a["id"])
        self.assertFalse(paths.claude_json().exists())
        self.assertEqual(storage.read_json(paths.cred_file()), creds("t1"))

    def test_switch_unknown_slot(self):
        with self.assertRaises(accounts.AccountError):
            accounts.switch_to("nope")

    def test_sync_current_back(self):
        self.login("t1", "u1", "a@x")
        a = accounts.save_current("A")
        self.assertFalse(accounts.sync_current_back())
        storage.write_json_atomic(paths.cred_file(), creds("new"))
        self.assertTrue(accounts.sync_current_back())
        self.assertEqual(accounts.get_slot(a["id"])["credentials"], creds("new"))

    def test_delete_current_refused(self):
        self.login("t1", "u1", "a@x")
        a = accounts.save_current("A")
        with self.assertRaises(accounts.AccountError):
            accounts.delete_slot(a["id"])
        self.login("t2", "u2", "b@x")
        accounts.delete_slot(a["id"])
        self.assertIsNone(accounts.get_slot(a["id"]))

    def test_mark_and_clear_exhausted(self):
        self.login("t1", "u1", "a@x")
        a = accounts.save_current("A")
        accounts.mark_exhausted(a["id"], 999.0)
        self.assertEqual(accounts.get_slot(a["id"])["exhausted_until"], 999.0)
        accounts.clear_exhausted(a["id"])
        self.assertEqual(accounts.get_slot(a["id"])["exhausted_until"], 0)


class ConfigTest(Base):
    def test_defaults_and_merge(self):
        self.assertEqual(config.load(), {"threshold": 95, "auto_switch": True, "last_folder": ""})
        config.save({"threshold": 80})
        cfg = config.load()
        self.assertEqual(cfg["threshold"], 80)
        self.assertTrue(cfg["auto_switch"])


if __name__ == "__main__":
    unittest.main()
