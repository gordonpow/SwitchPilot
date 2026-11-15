import unittest

from switcher.monitor import Monitor

NOW = 1000.0


def usage(slot="a", five=10, seven=10, ts=NOW, r5=5000.0, r7=9000.0):
    return {
        "slot_id": slot, "ts": ts,
        "five_hour": {"used_percentage": five, "resets_at": r5},
        "seven_day": {"used_percentage": seven, "resets_at": r7},
    }


def ev(kind="stop", slot="a", ts=NOW, error=None):
    return {"kind": kind, "slot_id": slot, "ts": ts, "error": error}


class MonitorTest(unittest.TestCase):
    def test_below_threshold_none(self):
        m = Monitor()
        self.assertEqual(m.tick(NOW, "a", usage(five=50), []).kind, "none")

    def test_threshold_pending(self):
        m = Monitor()
        act = m.tick(NOW, "a", usage(five=96), [])
        self.assertEqual(act.kind, "pending")
        self.assertEqual(act.exhausted_until, 5000.0)

    def test_pending_max_resets(self):
        m = Monitor()
        act = m.tick(NOW, "a", usage(five=96, seven=97), [])
        self.assertEqual(act.exhausted_until, 9000.0)

    def test_pending_then_stop_switches(self):
        m = Monitor()
        m.tick(NOW, "a", usage(five=96), [])
        act = m.tick(NOW + 5, "a", usage(five=96), [ev("stop", ts=NOW + 4)])
        self.assertEqual(act.kind, "switch_now")
        self.assertEqual(act.exhausted_until, 5000.0)

    def test_pending_cancel_when_usage_drops(self):
        m = Monitor()
        m.tick(NOW, "a", usage(five=96), [])
        act = m.tick(NOW + 5, "a", usage(five=20, ts=NOW + 5), [])
        self.assertEqual(act.kind, "none")
        # 取消後 stop 事件不再觸發
        act = m.tick(NOW + 6, "a", usage(five=20, ts=NOW + 6), [ev("stop", ts=NOW + 6)])
        self.assertEqual(act.kind, "none")

    def test_rate_limit_immediate_with_usage(self):
        m = Monitor()
        act = m.tick(NOW, "a", usage(five=99), [ev("stopfailure", error="rate_limit")])
        self.assertEqual(act.kind, "switch_now")
        self.assertEqual(act.exhausted_until, 5000.0)

    def test_rate_limit_without_usage(self):
        m = Monitor()
        act = m.tick(NOW, "a", None, [ev("stopfailure", error="rate_limit")])
        self.assertEqual(act.kind, "switch_now")
        self.assertEqual(act.exhausted_until, NOW + 5 * 3600)

    def test_other_error_not_immediate(self):
        m = Monitor()
        act = m.tick(NOW, "a", None, [ev("stopfailure", error="overloaded")])
        self.assertEqual(act.kind, "none")

    def test_other_slot_ignored(self):
        m = Monitor()
        self.assertEqual(m.tick(NOW, "a", usage(slot="b", five=99), []).kind, "none")
        act = m.tick(NOW, "a", None, [ev("stopfailure", slot="b", error="rate_limit")])
        self.assertEqual(act.kind, "none")

    def test_old_ts_ignored(self):
        m = Monitor()
        m.reset(NOW)
        self.assertEqual(m.tick(NOW + 1, "a", usage(five=99, ts=NOW - 1), []).kind, "none")
        act = m.tick(NOW + 1, "a", None, [ev("stopfailure", ts=NOW - 1, error="rate_limit")])
        self.assertEqual(act.kind, "none")

    def test_pending_timeout(self):
        m = Monitor(pending_timeout=600)
        m.tick(NOW, "a", usage(five=96), [])
        self.assertEqual(m.tick(NOW + 300, "a", usage(five=96), []).kind, "pending")
        act = m.tick(NOW + 601, "a", usage(five=96), [])
        self.assertEqual(act.kind, "switch_now")

    def test_reset_clears_pending(self):
        m = Monitor()
        m.tick(NOW, "a", usage(five=96), [])
        m.reset(NOW + 10)
        self.assertFalse(m.pending)
        self.assertEqual(m.since, NOW + 10)
        act = m.tick(NOW + 11, "a", None, [ev("stop", ts=NOW + 11)])
        self.assertEqual(act.kind, "none")


if __name__ == "__main__":
    unittest.main()
