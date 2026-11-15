import unittest

from switcher import switchplan


def S(i, until=0):
    return {"id": i, "exhausted_until": until}


class PickNextTest(unittest.TestCase):
    def test_cycles_after_current(self):
        slots = [S("a"), S("b"), S("c")]
        self.assertEqual(switchplan.pick_next(slots, "b", 100)["id"], "c")
        self.assertEqual(switchplan.pick_next(slots, "c", 100)["id"], "a")

    def test_skips_exhausted(self):
        slots = [S("a"), S("b", 500), S("c")]
        self.assertEqual(switchplan.pick_next(slots, "a", 100)["id"], "c")

    def test_expired_exhaustion_is_available(self):
        slots = [S("a"), S("b", 50)]
        self.assertEqual(switchplan.pick_next(slots, "a", 100)["id"], "b")

    def test_all_exhausted_returns_none(self):
        slots = [S("a"), S("b", 500), S("c", 600)]
        self.assertIsNone(switchplan.pick_next(slots, "a", 100))

    def test_only_current_returns_none(self):
        self.assertIsNone(switchplan.pick_next([S("a")], "a", 100))
        self.assertIsNone(switchplan.pick_next([], None, 100))

    def test_unknown_current(self):
        self.assertEqual(switchplan.pick_next([S("a"), S("b")], None, 1)["id"], "a")


class EarliestResetTest(unittest.TestCase):
    def test_min_of_future(self):
        slots = [S("a", 900), S("b", 300), S("c", 50)]
        self.assertEqual(switchplan.earliest_reset(slots, 100), 300)

    def test_none(self):
        self.assertIsNone(switchplan.earliest_reset([S("a"), S("b", 50)], 100))


if __name__ == "__main__":
    unittest.main()
