# Notification Slideover

A translucent notification history sheet for [Omarchy](https://omarchy.org/). It slides over the desktop from the right edge and does **not** push windows aside.

It reads live toasts and on-disk history from Omarchy's first-party `omarchy.notifications` service. It does not replace the notification daemon, and it does not replay history as new popups.

Author: [Steven Bower](https://github.com/BluSyn). Co-author: Grok (xAI).

![Notification slideover](screenshots/slideover.png)

## Using it

The sheet is usable on any Omarchy machine. Trackpad hardware is optional.

| Input | Where it is configured | Needs a trackpad? |
| --- | --- | --- |
| Two-finger swipe **left from the right edge of the pad** (follows your fingers) | Built into the plugin (`gesture.py`) | Yes, any real multitouch pad |
| Two-finger swipe right while open | Built into the plugin | Yes |
| Drag the **right edge of the screen** | Built into the plugin | No |
| `Super+period` (`Cmd+.`) | Hyprland bind you add (see below) | No |
| Four-finger swipe left / right | Optional Hyprland gesture (see below) | Yes, 4-finger libinput |
| Click a notification | Built in — jumps to the app | No |
| Hover ✕ / Clear / Esc / click outside | Built in | No |

Desktops, VMs, and laptops without a multitouch pad should bind `Super+period` and/or use the right-edge mouse drag. The two-finger watcher simply stays idle.

## Install

```bash
omarchy plugin add https://github.com/BluSyn/omarchy-notification-slideover.git --enable
```

HTTPS is enough. Then add the keyboard shortcut (and optionally the four-finger swipe) — **Omarchy plugins cannot write `~/.config/hypr`**, so this step is manual.

### Keyboard shortcut (recommended)

Check that the key is free:

```bash
omarchy menu keybindings --print | grep -i period
```

If `SUPER + period` is already bound, unbind it first. Then in `~/.config/hypr/bindings.lua`:

```lua
o.bind(
  "SUPER + period",
  "Notification slideover",
  "omarchy-shell shell toggle blusyn.notification-slideover '{}'"
)
```

Hyprland reloads that file on save. Confirm with `hyprctl reload` and `hyprctl configerrors`.

The ready-made file is `contrib/hyprland.lua` (keybind plus optional four-finger swipe). Either copy the snippets, or:

```lua
dofile(os.getenv("HOME") .. "/.config/omarchy/plugins/blusyn.notification-slideover/contrib/hyprland.lua")
```

`dofile` tracks plugin updates; a copy-paste survives removing the plugin without breaking Hyprland.

### Optional four-finger swipe

This is a Hyprland/libinput gesture, so it works on Synaptics, ELAN, Apple, and other pads libinput already uses for workspace swipes. Put it in `~/.config/hypr/input.lua` (or use `contrib/hyprland.lua` above):

```lua
hl.gesture({
  fingers = 4,
  direction = "left",
  action = function()
    hl.dispatch(hl.dsp.exec_cmd("omarchy-shell shell toggle blusyn.notification-slideover '{}'"))
  end,
})
hl.gesture({
  fingers = 4,
  direction = "right",
  action = function()
    hl.dispatch(hl.dsp.exec_cmd("omarchy-shell shell toggle blusyn.notification-slideover '{}'"))
  end,
})
```

Do **not** bind a two-finger Hyprland gesture — that steals scrolling. The macOS-style two-finger *edge* swipe is implemented inside the plugin by reading the pad directly.

### Two-finger edge swipe (no Hyprland config)

The plugin starts a small observer on `/dev/input` (it never grabs the device). Any Linux multitouch trackpad that reports `ABS_MT` slots should work: Apple SPI/Magic Trackpad, Synaptics, ELAN, ALPS, and HID precision pads. You must be in the `input` group (Omarchy's default).

Optional package for that watcher only:

```bash
omarchy pkg add python-libevdev
```

Without it, two-finger swipe is disabled; keyboard, mouse-edge drag, and the four-finger Hyprland gesture still work.

List what the watcher would use:

```bash
python3 ~/.config/omarchy/plugins/blusyn.notification-slideover/gesture.py --list
```

## Requirements

- Omarchy with `omarchy.notifications` enabled
- For two-finger edge swipe: `python-libevdev` and membership in `input`

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Keybind does nothing | `omarchy plugin list` should show `blusyn.notification-slideover` enabled. Run `omarchy-shell shell toggle blusyn.notification-slideover '{}'` to test without Hyprland. |
| Two-finger swipe does nothing, keybind works | `python3 …/gesture.py --list`. If every device is `skip`, the pad is not true multitouch (or is a touchscreen). Use the keybind or right-edge drag. |
| `unreadable` on `/dev/input/event*` | `groups` should include `input`. Log out after adding the group. |
| Incidental scroll at the start of an edge swipe | Expected. The watcher only observes the pad, so a few pixels of two-finger scroll can leak. |
| Plugin update overwrote nothing in Hyprland | Intended. Binds live in your config; update them only if the toggle command in this README changes. |

## Design notes

- **Overlay layer, `ExclusionMode.Ignore`.** Tiled windows stay put.
- **Glass, not a dimmer.** The sheet uses the theme background, shifted toward black or white for contrast, at high opacity so type stays readable over busy windows. The rest of the desktop is only lightly shaded.
- **Clears the bar completely.** The overlay is inset by Hyprland's reserved edge for whatever side the Omarchy bar occupies (top, bottom, left, or right), including the Apple notch strip. It never covers a few pixels of the bar.
- **History is Omarchy's.** Individual history dismissals delete the matching file under `~/.local/state/omarchy/notifications/history/` when the service has no `removeHistoryEntry` API.

## Development

```bash
node --test tests/test_logic.js
python3 tests/test_gesture.py
omarchy plugin validate .
```

Saving anything under this folder hot-reloads plugin code. `omarchy restart shell` if the gesture watcher gets stuck.

## Security

The plugin runs unsandboxed inside `omarchy-shell`. The trackpad watcher is observe-only: it never `EVIOCGRAB`s the device. Only install this from a source you trust.

## License

MIT
