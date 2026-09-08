# Notification Slideover

A macOS-style notification center for [Omarchy](https://omarchy.org/). Author: **Steven Bower**. Co-author: **Grok (xAI)**.

Two-finger swipe inward from the right-most edge of the trackpad and a translucent sheet slides over the desktop. Windows stay put — the sheet is an overlay, not a reserved layer. Swipe the other way, click the dimmed desktop, or press Esc to put it away.

It reads live toasts and on-disk history from Omarchy's first-party `omarchy.notifications` service. It does not replace the notification daemon, and it does not replay history as new popups.

## Why this exists

`shavanced.notification-center` is a bar dropdown with the same data. This plugin is a separate take on that idea: edge-swipe instead of a bar icon, a full-height slide-over instead of a popup, and a quieter layout (clock, DND, search, grouped list).

Leave the bar widget installed if you like both, or disable it and keep this as the only history UI.

## Gestures and shortcuts

| Input | Action |
| --- | --- |
| Two fingers starting on the **right edge of the trackpad**, swipe left | Pull the sheet open (follows your fingers) |
| Two-finger swipe right while it is open | Push the sheet closed |
| Drag the right screen edge (or the sheet's left handle) | Same interactive open/close, for a mouse |
| Four-finger swipe left / right | Toggle (Hyprland gesture, does not fight two-finger scroll) |
| `Super+period` (`Cmd+.`) | Toggle |
| Click a notification | Jump to the app and close the sheet |
| Hover ✕ | Dismiss one |
| Clear | Dismiss live toasts and wipe saved history |
| Esc / click outside | Close |

The trackpad watcher only *observes* `/dev/input`. It never grabs the device, so a crash cannot kill the pad. A few pixels of two-finger scroll can leak at the start of an edge swipe; that is the trade.

You need to be in the `input` group (Omarchy's default) so the watcher can read the trackpad.

## Requirements

- Omarchy with `omarchy.notifications`
- `python-libevdev` (Arch: `python-libevdev`)
- A multitouch trackpad. Tuned on an Apple SPI trackpad; any `ABS_MT` pad with a right edge should work.

## Install

```bash
omarchy plugin add git@github.com:BluSyn/omarchy-notification-slideover.git --enable
```

Or clone by hand into `~/.config/omarchy/plugins/blusyn.notification-slideover`, then:

```bash
omarchy plugin validate ~/.config/omarchy/plugins/blusyn.notification-slideover
omarchy plugin enable blusyn.notification-slideover
```

The overlay is `keepLoaded`, so the gesture watcher starts with the shell. Summon it by hand with:

```bash
omarchy-shell shell toggle blusyn.notification-slideover '{}'
omarchy-shell notification-slideover state   # open | closed
```

## Design notes

- **Overlay layer, `ExclusionMode.Ignore`.** Hyprland does not push tiled windows aside. The sheet is a top float, like macOS Notification Center.
- **Glass, not a dimmer.** If the Omarchy bar is transparent, the sheet stays translucent and the rest of the desktop is only barely shaded. No opaque card, no 50% scrim.
- **Sits below the bar.** Top clearance follows the live bar height (including the Apple notch floor) so the clock and tray stay clickable until the sheet is fully open.
- **History is Omarchy's.** Individual history dismissals delete the matching `~/.local/state/omarchy/notifications/history/` file when the service has no `removeHistoryEntry` API.

## Development

```bash
node --test tests/test_logic.js
python3 tests/test_gesture.py
omarchy plugin validate .
```

Saving anything under this folder hot-reloads the plugin. The gesture process is restarted with the overlay; `omarchy restart shell` is the hammer if a watcher gets stuck.

## Security

Omarchy plugins run unsandboxed inside `omarchy-shell`. Only install this from a source you trust.

## License

MIT
