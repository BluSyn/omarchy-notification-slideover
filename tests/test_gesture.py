#!/usr/bin/env python3
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from gesture import EdgeSwipe


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


if __name__ == "__main__":
    unittest.main()
