#!/usr/bin/env python3
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import libevdev
from gesture import EdgeSwipe, is_trackpad, _axis_range, _has_prop


def fingers(a, b):
    return [{"id": 1, "x": a[0], "y": a[1]}, {"id": 2, "x": b[0], "y": b[1]}]


class EdgeSwipeTests(unittest.TestCase):
    def setUp(self):
        # Match the Apple SPI pad range, compressed for readability.
        self.s = EdgeSwipe(x_min=0, x_max=1000, y_min=0, y_max=1000, full_swipe=0.30)

    def swipe(self, start, end, steps=6, t0=1.0):
        events = []
        sx, sy = start
        ex, ey = end
        # First frame parks the pending start; subsequent frames move.
        self.s.on_frame(fingers((sx, sy), (sx + 8, sy + 4)), t0)
        for i in range(1, steps + 1):
            p = i / steps
            x = sx + (ex - sx) * p
            y = sy + (ey - sy) * p
            event = self.s.on_frame(fingers((x, y), (x + 8, y + 4)), t0 + i * 0.04)
            if event:
                events.append(event)
        return events

    def test_right_edge_left_swipe_opens(self):
        events = self.swipe((940, 400), (600, 410))
        self.assertTrue(events)
        self.assertEqual(events[0]["phase"], "begin")
        self.assertEqual(events[0]["kind"], "open")
        self.assertEqual(events[-1]["kind"], "open")
        self.assertGreater(events[-1]["amount"], 0.5)

    def test_middle_left_swipe_is_ignored(self):
        events = self.swipe((500, 400), (200, 410))
        self.assertEqual(events, [])

    def test_right_edge_vertical_scroll_is_ignored(self):
        events = self.swipe((940, 200), (930, 700))
        self.assertEqual(events, [])

    def test_rightward_swipe_closes(self):
        events = self.swipe((400, 400), (800, 410))
        self.assertTrue(events)
        self.assertEqual(events[0]["kind"], "close")
        self.assertGreater(events[-1]["amount"], 0.5)

    def test_three_fingers_cancel_an_open_gesture(self):
        self.s.on_frame(fingers((940, 400), (948, 404)), 1.0)
        begin = self.s.on_frame(fingers((800, 400), (808, 404)), 1.08)
        self.assertIsNotNone(begin)
        self.assertEqual(begin["phase"], "begin")
        extra = [
            {"id": 1, "x": 700, "y": 400},
            {"id": 2, "x": 708, "y": 404},
            {"id": 3, "x": 720, "y": 410},
        ]
        end = self.s.on_frame(extra, 1.12)
        self.assertEqual(end["phase"], "cancel")
        self.assertFalse(self.s.active)

    def test_finger_lift_ends_committed_gesture(self):
        self.s.on_frame(fingers((940, 400), (948, 404)), 1.0)
        self.s.on_frame(fingers((700, 400), (708, 404)), 1.10)
        end = self.s.on_frame([{"id": 1, "x": 700, "y": 400}], 1.16)
        self.assertIn(end["phase"], ("end", "cancel"))
        self.assertFalse(self.s.active)

    def test_edge_x_is_the_right_strip(self):
        self.assertGreater(self.s.edge_x, 800)
        self.assertTrue(self.s.in_right_edge(900))
        self.assertFalse(self.s.in_right_edge(100))

    def test_amount_stays_in_unit_interval_and_velocity_is_clamped(self):
        from gesture import MAX_VELOCITY, clamp_velocity, emit, clamp01

        events = self.swipe((990, 400), (0, 400), steps=8)
        for event in events:
            self.assertGreaterEqual(event["amount"], 0.0)
            self.assertLessEqual(event["amount"], 1.0)
            self.assertGreaterEqual(event["velocity"], -MAX_VELOCITY)
            self.assertLessEqual(event["velocity"], MAX_VELOCITY)
        self.assertEqual(clamp_velocity(99), MAX_VELOCITY)
        self.assertEqual(clamp_velocity(-99), -MAX_VELOCITY)
        self.assertEqual(clamp01(4), 1.0)
        self.assertEqual(clamp01(-1), 0.0)

        captured = []

        class FakeOut:
            def write(self, line):
                captured.append(line)
            def flush(self):
                pass

        import sys as real_sys
        real_stdout = real_sys.stdout
        real_sys.stdout = FakeOut()
        try:
            emit({"v": 1, "phase": "end", "kind": "open", "amount": 9, "velocity": 50, "fingers": 2})
        finally:
            real_sys.stdout = real_stdout
        self.assertEqual(len(captured), 1)
        self.assertLessEqual(len(captured[0]), 257)
        self.assertIn('"amount":1.0', captured[0])
        self.assertIn('"velocity":8.0', captured[0])


class FakeAbs:
    def __init__(self, minimum, maximum):
        self.minimum = minimum
        self.maximum = maximum


class FakeDevice:
    def __init__(self, name, codes, props, absinfo=None):
        self.name = name
        self._codes = set(codes)
        self.properties = props
        self.absinfo = absinfo or {}

    def has(self, code):
        return code in self._codes


MT = [libevdev.EV_ABS.ABS_MT_POSITION_X, libevdev.EV_ABS.ABS_MT_SLOT]
DOUBLETAP = MT + [libevdev.EV_KEY.BTN_TOOL_DOUBLETAP]


class TrackpadMatchTests(unittest.TestCase):
    def test_apple_spi_is_accepted(self):
        d = FakeDevice("Apple SPI Trackpad", MT, ["INPUT_PROP_POINTER:0", "INPUT_PROP_BUTTONPAD:2"])
        self.assertTrue(is_trackpad(d))

    def test_synaptics_and_elan_names_are_accepted(self):
        self.assertTrue(is_trackpad(FakeDevice("SynPS/2 Synaptics TouchPad", MT, ["INPUT_PROP_BUTTONPAD:2"])))
        self.assertTrue(is_trackpad(FakeDevice("ELAN1200:00 04F3:3090 Touchpad", MT, ["INPUT_PROP_BUTTONPAD:2"])))

    def test_clickpad_without_a_brand_name_is_accepted(self):
        d = FakeDevice("Generic PNP device", DOUBLETAP, ["INPUT_PROP_BUTTONPAD:2"])
        self.assertTrue(is_trackpad(d))

    def test_touchscreen_is_rejected(self):
        d = FakeDevice("ELAN Touchscreen", MT, ["INPUT_PROP_DIRECT:1"])
        self.assertFalse(is_trackpad(d))

    def test_semi_mt_is_rejected(self):
        d = FakeDevice("Synaptics TM", MT, ["INPUT_PROP_SEMI_MT:1", "INPUT_PROP_POINTER:0"])
        self.assertFalse(is_trackpad(d))

    def test_pointer_tablet_without_pad_signals_is_rejected(self):
        d = FakeDevice("Wacom Intuos", MT, ["INPUT_PROP_POINTER:0"])
        self.assertFalse(is_trackpad(d))

    def test_has_prop_is_case_tolerant(self):
        self.assertTrue(_has_prop(["INPUT_PROP_BUTTONPAD:2"], "buttonpad"))
        self.assertFalse(_has_prop(["INPUT_PROP_POINTER:0"], "BUTTONPAD"))


class AxisRangeTests(unittest.TestCase):
    def test_swaps_inverted_min_max(self):
        d = FakeDevice("pad", MT, [], {
            libevdev.EV_ABS.ABS_MT_POSITION_X: FakeAbs(800, 0),
        })
        self.assertEqual(_axis_range(d, libevdev.EV_ABS.ABS_MT_POSITION_X), (0, 800))

    def test_rejects_tiny_axes(self):
        d = FakeDevice("pad", MT, [], {
            libevdev.EV_ABS.ABS_MT_POSITION_X: FakeAbs(0, 10),
        })
        self.assertIsNone(_axis_range(d, libevdev.EV_ABS.ABS_MT_POSITION_X))


if __name__ == "__main__":
    unittest.main()
