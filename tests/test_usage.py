import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from switcher import paths, usage  # noqa: E402

_KEYS = ("CLAUDE_SWITCHER_HOME", "CLAUDE_SWITCHER_CLAUDE_HOME", "CLAUDE_SWITCHER_CLAUDE_JSON")


class UsageTests(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in _KEYS}
        self._tmp = tempfile.TemporaryDirectory()
        t = Path(self._tmp.name)
        os.environ["CLAUDE_SWITCHER_HOME"] = str(t / "app")
        os.environ["CLAUDE_SWITCHER_CLAUDE_HOME"] = str(t / "claude")
        os.environ["CLAUDE_SWITCHER_CLAUDE_JSON"] = str(t / "claude.json")

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._tmp.cleanup()

    def put_usage(self, sid, slot, ts):
        d = paths.usage_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / (sid + ".json")).write_text(
            json.dumps({"session_id": sid, "slot_id": slot, "ts": ts,
                        "five_hour": None, "seven_day": None}), encoding="utf-8")

    def put_event(self, name, **kw):
        d = paths.events_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(json.dumps(kw), encoding="utf-8")

    def test_latest_usage_by_slot_and_since(self):
        self.assertIsNone(usage.latest_usage("a"))
        self.put_usage("s1", "a", 100.0)
        self.put_usage("s2", "a", 200.0)
        self.put_usage("s3", "b", 300.0)
        self.assertEqual(usage.latest_usage("a")["session_id"], "s2")
        self.assertEqual(usage.latest_usage("b")["session_id"], "s3")
        self.assertIsNone(usage.latest_usage("c"))
        self.assertIsNone(usage.latest_usage("a", since=250.0))
        self.assertEqual(usage.latest_usage("a", since=150.0)["session_id"], "s2")

    def test_is_stale(self):
        self.assertFalse(usage.is_stale({"ts": 1000.0}, 1500.0))
        self.assertTrue(usage.is_stale({"ts": 1000.0}, 1700.0))
        self.assertTrue(usage.is_stale({"ts": 1000.0}, 1200.0, max_age=100))
        self.assertTrue(usage.is_stale({}, 1.0))

    def test_read_new_events_watermark(self):
        self.assertEqual(usage.read_new_events(None), ([], None))
        self.assertEqual(usage.read_new_events("5-a.json"), ([], "5-a.json"))
        self.put_event("1-aaaa.json", kind="stop")
        self.put_event("2-bbbb.json", kind="stopfailure")
        evs, last = usage.read_new_events(None)
        self.assertEqual([e["_name"] for e in evs], ["1-aaaa.json", "2-bbbb.json"])
        self.assertEqual(last, "2-bbbb.json")
        evs, last2 = usage.read_new_events(last)
        self.assertEqual(evs, [])
        self.assertEqual(last2, last)
        self.put_event("3-cccc.json", kind="stop")
        evs, last3 = usage.read_new_events(last)
        self.assertEqual([e["kind"] for e in evs], ["stop"])
        self.assertEqual(last3, "3-cccc.json")

    def test_cleanup(self):
        self.put_usage("old", "a", 1.0)
        self.put_usage("new", "a", 2.0)
        self.put_event("1-aaaa.json", kind="stop")
        old = time.time() - 200000
        os.utime(paths.usage_dir() / "old.json", (old, old))
        os.utime(paths.events_dir() / "1-aaaa.json", (old, old))
        usage.cleanup(time.time())
        self.assertFalse((paths.usage_dir() / "old.json").exists())
        self.assertTrue((paths.usage_dir() / "new.json").exists())
        self.assertFalse((paths.events_dir() / "1-aaaa.json").exists())


if __name__ == "__main__":
    unittest.main()
