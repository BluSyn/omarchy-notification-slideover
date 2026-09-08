-- Hyprland extras for blusyn.notification-slideover
--
-- Omarchy plugins cannot write ~/.config/hypr. Copy the snippets you want
-- into ~/.config/hypr/bindings.lua (and input.lua for the gesture), or:
--
--   dofile(os.getenv("HOME") .. "/.config/omarchy/plugins/blusyn.notification-slideover/contrib/hyprland.lua")
--
-- Check for conflicts first: omarchy menu keybindings --print
-- If SUPER + period is already bound, hl.unbind it before o.bind.

-- Keyboard (works on every machine, including desktops with no trackpad).
-- Super+comma is Omarchy's "dismiss last notification"; period is the next key.
o.bind(
  "SUPER + period",
  "Notification slideover",
  "omarchy-shell shell toggle blusyn.notification-slideover '{}'"
)

-- Optional: four-finger swipe left/right toggles the sheet.
-- This is a Hyprland/libinput gesture, so it works on any multitouch pad
-- libinput already uses for 3/4-finger swipes — not just Apple hardware.
-- Do NOT bind a two-finger Hyprland gesture; that steals scrolling.
-- Two-finger *right-edge* swipe is handled inside the plugin via evdev
-- and needs no Hyprland bind.
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
