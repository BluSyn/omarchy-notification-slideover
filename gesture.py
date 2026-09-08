#!/usr/bin/env python3
"""Watch a multitouch trackpad and emit right-edge swipe events.

Two fingers that start on the right-most strip of the pad and move left
open the notification sheet. Two fingers moving right close it. Vertical
motion is treated as scroll and ignored. JSON objects, one per line, go to
stdout; diagnostics go to stderr.

Works on any Linux ABS_MT clickpad (Apple, Synaptics, ELAN, ALPS, HID
precision pads). Keyboard and mouse-edge drag do not use this process.

This process only observes /dev/input — it never grabs the device — so a
crash cannot eat the trackpad. A little incidental two-finger scroll can
leak through at the start of a gesture; that is the trade for not stealing
the device from libinput.
"""

from __future__ import annotations

import glob
import json
import os
import select
import sys
import time
from typing import Any

try:
    import libevdev
except ImportError:  # pragma: no cover
    # Watcher is optional: keyboard, mouse-edge drag, and Hyprland binds
    # still open the sheet. Exit 0 so the overlay does not restart us in a loop.
    print("python-libevdev is not installed; two-finger edge swipe disabled", file=sys.stderr)
    sys.exit(0)


# Right-most fraction of the pad that counts as the "edge" for *opening*.
EDGE_FRACTION = 0.16
# Ignore motion smaller than this fraction of pad width (finger jitter).
SLOP = 0.018
# Horizontal swipe of this fraction of pad width maps to amount=1.
FULL_SWIPE = 0.30
# Vertical motion wins (it's a scroll) if |dy| exceeds |dx| times this.
VERTICAL_RATIO = 1.15


MAX_JSON_LINE = 256
MAX_VELOCITY = 8.0


def clamp_velocity(value: float) -> float:
    if value > MAX_VELOCITY:
        return MAX_VELOCITY
    if value < -MAX_VELOCITY:
        return -MAX_VELOCITY
    return float(value)


def emit(payload: dict[str, Any]) -> None:
    try:
        amount = float(payload.get("amount", 0.0))
    except (TypeError, ValueError):
        amount = 0.0
    try:
        velocity = float(payload.get("velocity", 0.0))
    except (TypeError, ValueError):
        velocity = 0.0
    payload["amount"] = round(clamp01(amount), 4)
    payload["velocity"] = round(clamp_velocity(velocity), 4)
    line = json.dumps(payload, separators=(",", ":"))
    if len(line) > MAX_JSON_LINE:
        return
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return float(value)


class EdgeSwipe:
    """Classify a stream of 2-finger frames into open/close gestures."""

    def __init__(
        self,
        x_min: int,
        x_max: int,
        y_min: int,
        y_max: int,
        edge_fraction: float = EDGE_FRACTION,
        slop: float = SLOP,
        full_swipe: float = FULL_SWIPE,
        vertical_ratio: float = VERTICAL_RATIO,
    ) -> None:
        self.x_min = int(x_min)
        self.x_max = int(x_max)
        self.y_min = int(y_min)
        self.y_max = int(y_max)
        self.width = max(1, self.x_max - self.x_min)
        self.height = max(1, self.y_max - self.y_min)
        self.edge_fraction = float(edge_fraction)
        self.slop = float(slop)
        self.full_swipe = float(full_swipe)
        self.vertical_ratio = float(vertical_ratio)
        self.reset()

    @property
    def edge_x(self) -> float:
        return self.x_max - self.width * self.edge_fraction

    def reset(self) -> None:
        self.active = False
        self.kind: str | None = None
        self.start_x = 0.0
        self.start_y = 0.0
        self.start_t = 0.0
        self.last_x = 0.0
        self.last_t = 0.0
        self.amount = 0.0
        self.velocity = 0.0
        self._pending: dict[str, Any] | None = None

    def in_right_edge(self, x: float) -> bool:
        return x >= self.edge_x

    def _finish(self, t: float, cancelled: bool) -> dict[str, Any]:
        kind = self.kind or "open"
        event = {
            "v": 1,
            "phase": "cancel" if cancelled else "end",
            "kind": kind,
            "amount": round(self.amount, 4),
            "velocity": round(self.velocity, 4),
            "fingers": 2,
        }
        self.reset()
        return event

    def on_frame(self, fingers: list[dict[str, float]], t: float) -> dict[str, Any] | None:
        n = len(fingers)
        if n != 2:
            if self.active:
                # Three-plus fingers is a workspace swipe; abort so we don't
                # fight Hyprland. A lift before commit is also a cancel.
                cancelled = n > 2 or self.amount < 0.08
                return self._finish(t, cancelled=cancelled)
            self._pending = None
            return None

        cx = mean([f["x"] for f in fingers])
        cy = mean([f["y"] for f in fingers])

        if not self.active:
            if self._pending is None:
                self._pending = {
                    "x": cx,
                    "y": cy,
                    "t": t,
                    "edge": all(self.in_right_edge(f["x"]) for f in fingers),
                }
                return None

            dx = (cx - self._pending["x"]) / self.width
            dy = (cy - self._pending["y"]) / self.height
            if abs(dx) < self.slop and abs(dy) < self.slop:
                return None
            if abs(dy) > abs(dx) * self.vertical_ratio:
                self._pending = None
                return None

            # Open is macOS-strict: two fingers must begin on the right-most
            # strip and move left. Close is the reverse swipe from anywhere;
            # the overlay ignores it when the sheet is already shut.
            if dx < 0 and not self._pending["edge"]:
                self._pending = None
                return None

            self.active = True
            self.kind = "open" if dx < 0 else "close"
            self.start_x = self._pending["x"]
            self.start_y = self._pending["y"]
            self.start_t = self._pending["t"]
            self.last_x = cx
            self.last_t = t
            self._pending = None
            self.amount, self.velocity = self._metrics(cx, t)
            return {
                "v": 1,
                "phase": "begin",
                "kind": self.kind,
                "amount": round(self.amount, 4),
                "velocity": round(self.velocity, 4),
                "fingers": 2,
            }

        self.amount, self.velocity = self._metrics(cx, t)
        # Direction reversed far enough to cancel a not-yet-committed swipe.
        if self.amount <= 0.0 and self.velocity < 0:
            return self._finish(t, cancelled=True)
        self.last_x = cx
        self.last_t = t
        return {
            "v": 1,
            "phase": "update",
            "kind": self.kind,
            "amount": round(self.amount, 4),
            "velocity": round(self.velocity, 4),
            "fingers": 2,
        }

    def _metrics(self, cx: float, t: float) -> tuple[float, float]:
        dx = (cx - self.start_x) / self.width
        directed = -dx if self.kind == "open" else dx
        amount = clamp01(directed / self.full_swipe)
        dt = max(0.001, t - self.last_t)
        step = (cx - self.last_x) / self.width / dt
        velocity = -step if self.kind == "open" else step
        return amount, clamp_velocity(velocity)


def _prop_names(device: libevdev.Device) -> list[str]:
    try:
        return [str(p) for p in device.properties]
    except Exception:
        return []


def _has_prop(props: list[str], token: str) -> bool:
    upper = token.upper()
    return any(upper in p.upper() for p in props)


def is_trackpad(device: libevdev.Device) -> bool:
    """True for real multitouch clickpads/trackpads, not screens or semi-MT.

    Linux evdev reports ABS_MT on laptops from Apple, Synaptics, ELAN, ALPS,
    and most HID "Precision Touchpad" devices. X is assumed to increase toward
    the right, which is the kernel convention, so the right-edge test is not
    Apple-specific.
    """
    if not device.has(libevdev.EV_ABS.ABS_MT_POSITION_X):
        return False
    if not device.has(libevdev.EV_ABS.ABS_MT_SLOT):
        return False

    props = _prop_names(device)
    # Bounding-box "semi-MT" pads do not report per-finger positions we can
    # trust for an edge test. Touchscreens (DIRECT) are not trackpads.
    if _has_prop(props, "SEMI_MT"):
        return False
    if _has_prop(props, "DIRECT") and not _has_prop(props, "BUTTONPAD"):
        return False

    name = (device.name or "").lower()
    named = any(
        token in name
        for token in (
            "trackpad",
            "touchpad",
            "synaptics",
            "synps/2",
            "elan",
            "alps",
            "bcm5974",
            "magic trackpad",
            "apple spi",
            "pixart",
            "cirque",
            "dll",
            "hid-over-i2c",
        )
    )
    if named or _has_prop(props, "BUTTONPAD"):
        return True
    try:
        return bool(device.has(libevdev.EV_KEY.BTN_TOOL_DOUBLETAP))
    except Exception:
        return False


def _axis_range(device: libevdev.Device, code: Any) -> tuple[int, int] | None:
    info = device.absinfo[code]
    if info is None:
        return None
    lo, hi = int(info.minimum), int(info.maximum)
    if lo > hi:
        lo, hi = hi, lo
    if hi - lo < 100:
        return None
    return lo, hi


class SlotTracker:
    """Reconstruct current finger positions from ABS_MT slot events."""

    def __init__(self) -> None:
        self.slot = 0
        self.slots: dict[int, dict[str, float]] = {}

    def feed(self, code: Any, value: int) -> None:
        if code == libevdev.EV_ABS.ABS_MT_SLOT:
            self.slot = int(value)
            return
        slot = self.slots.setdefault(self.slot, {"id": -1, "x": 0.0, "y": 0.0})
        if code == libevdev.EV_ABS.ABS_MT_TRACKING_ID:
            slot["id"] = int(value)
            if value < 0:
                self.slots.pop(self.slot, None)
        elif code == libevdev.EV_ABS.ABS_MT_POSITION_X:
            slot["x"] = float(value)
        elif code == libevdev.EV_ABS.ABS_MT_POSITION_Y:
            slot["y"] = float(value)

    def fingers(self) -> list[dict[str, float]]:
        out = []
        for slot in self.slots.values():
            if slot.get("id", -1) >= 0:
                out.append({"id": slot["id"], "x": slot["x"], "y": slot["y"]})
        return out


def open_trackpads() -> list[tuple[str, Any, libevdev.Device, EdgeSwipe, SlotTracker]]:
    found: list[tuple[str, Any, libevdev.Device, EdgeSwipe, SlotTracker]] = []
    for path in sorted(glob.glob("/dev/input/event*")):
        try:
            handle = open(path, "rb")
        except OSError:
            continue
        try:
            device = libevdev.Device(handle)
        except Exception:
            handle.close()
            continue
        if not is_trackpad(device):
            handle.close()
            continue
        abs_x = _axis_range(device, libevdev.EV_ABS.ABS_MT_POSITION_X)
        abs_y = _axis_range(device, libevdev.EV_ABS.ABS_MT_POSITION_Y)
        if abs_x is None or abs_y is None:
            handle.close()
            continue
        swipe = EdgeSwipe(abs_x[0], abs_x[1], abs_y[0], abs_y[1])
        os.set_blocking(handle.fileno(), False)
        found.append((path, handle, device, swipe, SlotTracker()))
        print(
            f"watching {path} ({device.name}) x={abs_x[0]}..{abs_x[1]} "
            f"y={abs_y[0]}..{abs_y[1]} edge_x>={swipe.edge_x:.0f}",
            file=sys.stderr,
            flush=True,
        )
    return found


def pump_device(
    device: libevdev.Device, swipe: EdgeSwipe, tracker: SlotTracker
) -> None:
    try:
        events = list(device.events())
    except libevdev.EventsDroppedException:
        try:
            events = list(device.sync())
        except Exception:
            return
        tracker.slots.clear()
    except OSError:
        raise

    for event in events:
        if event.matches(libevdev.EV_ABS):
            tracker.feed(event.code, int(event.value or 0))
        elif event.matches(libevdev.EV_SYN.SYN_REPORT):
            t = (event.sec or 0) + (event.usec or 0) / 1_000_000.0
            if t <= 0:
                t = time.monotonic()
            payload = swipe.on_frame(tracker.fingers(), t)
            if payload:
                emit(payload)


def list_devices() -> int:
    """Print every candidate pad and exit. Used by the README troubleshooting steps."""
    n = 0
    for path in sorted(glob.glob("/dev/input/event*")):
        try:
            handle = open(path, "rb")
        except OSError as exc:
            print(f"{path}: unreadable ({exc})")
            continue
        try:
            device = libevdev.Device(handle)
        except Exception as exc:
            print(f"{path}: {exc}")
            handle.close()
            continue
        accepted = is_trackpad(device)
        abs_x = _axis_range(device, libevdev.EV_ABS.ABS_MT_POSITION_X) if accepted else None
        mark = "watch" if accepted and abs_x else "skip"
        print(f"{mark}  {path}  {device.name!r}  props={_prop_names(device)}")
        if accepted and abs_x:
            n += 1
        handle.close()
    if n == 0:
        print("no multitouch trackpad found (keyboard shortcut and right-edge mouse drag still work)")
    return 0


def run() -> None:
    print("notification-slideover gesture watcher starting", file=sys.stderr, flush=True)
    delay = 1.5
    while True:
        devices = open_trackpads()
        if not devices:
            print(
                f"no multitouch trackpad found; retrying in {delay:.0f}s "
                "(Super+period / right-edge drag still work)",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(delay)
            delay = min(30.0, delay * 2)
            continue
        delay = 1.5
        try:
            while True:
                ready, _, _ = select.select([item[1] for item in devices], [], [], 2.0)
                if not ready:
                    continue
                for path, handle, device, swipe, tracker in devices:
                    if handle not in ready:
                        continue
                    pump_device(device, swipe, tracker)
        except (OSError, libevdev.InvalidFileError) as exc:
            print(f"device lost ({exc}); rescanning", file=sys.stderr, flush=True)
        finally:
            for _, handle, _, _, _ in devices:
                try:
                    handle.close()
                except Exception:
                    pass
        time.sleep(0.4)


if __name__ == "__main__":
    try:
        if "--list" in sys.argv:
            raise SystemExit(list_devices())
        run()
    except KeyboardInterrupt:
        pass
