# Repository guidance

## Layout

| File | Role |
| --- | --- |
| `Overlay.qml` | Layer-shell sheet, IPC, history IO, gesture process. |
| `NotificationLogic.js` | Pure merge/search/history/gesture helpers. `node --test` runs it. |
| `gesture.py` | libevdev watcher. `EdgeSwipe` is the testable classifier; the daemon is `run()`. |

## Contracts that will bite you

**`opened` vs `progress`.** `opened` is the committed state the shell IPC `toggle`/`isPluginOpen` path reads. `progress` is the visual 0–1. A trackpad drag from closed must *not* set `opened` until snap, or a keybind mid-drag will fight the gesture.

**Do not grab the trackpad.** `gesture.py` is observe-only. Grabbing `/dev/input/event2` to swallow scroll will freeze the pad if the process dies. Incidental scroll at gesture start is accepted.

**Open is edge-strict; close is not.** Two fingers must begin in the right-most `EDGE_FRACTION` of the pad and move left to open. Close is any two-finger swipe right — the overlay ignores those events when the sheet is shut, so browser-forward in the middle of the pad still works.

**History files are the API.** Omarchy's notification service does not expose `removeHistoryEntry`. Dismissing a historical row hides it locally and `rm`s `history/<timestamp>-<originalId>.json`. Do not rewrite `notifications.json`; that file is DND state only.

**`keepLoaded: true` is required.** The watcher and the off-screen edge hitbox have to exist before the first swipe. A summoned-only overlay would miss the start of the gesture.

**`close()` must not call `shell.hide()`.** The shell's hide path *is* `item.close()`. Calling hide from close recurses until the stack blows. `isPluginOpen()` already reads `opened`. Do not declare IpcHandler methods named `open`/`close`/`toggle` either — Quickshell attaches those onto the item and they shadow the shell contract.

**Mask, not `visible: false`.** The `PanelWindow` stays mapped. `WlrLayershell` mask is the 12px right strip when closed, the sheet while dragging, and the full click-catcher when committed open. Turning `visible` off unmaps the surface and the next swipe has to wait for a map.

## Hyprland

`SUPER + period` toggles the overlay (`Cmd+.`; Super+comma is already dismiss-last). Four-finger left/right is an extra toggle next to the existing three-finger workspace swipe. Two-finger Hyprland gestures are *not* bound — they steal scrolling.

## Tests

```bash
node --test tests/test_logic.js
python3 tests/test_gesture.py
omarchy plugin validate .
```
