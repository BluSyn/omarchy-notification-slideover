const test = require("node:test")
const assert = require("node:assert/strict")
const Logic = require("../NotificationLogic.js")

test("sanitizeBody strips img tags without manufacturing new ones", () => {
  const nested = '<im<img src="http://a/decoy.png">g src="http://a/beacon.png">'
  assert.equal(Logic.stripImageTags(nested), nested)
  assert.equal(Logic.sanitizeBody("hello <img src=\"http://x\"> world"), "hello  world")
})

test("chromium bodies drop a leading URL", () => {
  const body = "https://example.com/x hello there"
  assert.equal(Logic.sanitizeBody(body, "Chromium", "chromium"), "hello there")
  assert.equal(Logic.sanitizeBody(body, "Firefox", ""), body)
})

test("parseHistoryFiles reads line-delimited JSON and sorts newest first", () => {
  const raw = [
    JSON.stringify({ id: 1, app: "Mail", summary: "Old", timestamp: 100 }),
    "not json",
    JSON.stringify({ id: 2, app: "Chat", summary: "New", timestamp: 200 }),
    ""
  ].join("\n")
  const rows = Logic.parseHistoryFiles(raw, 10)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].summary, "New")
  assert.equal(rows[1].summary, "Old")
})

test("mergeRows prefers live, hides dismissed, and filters search", () => {
  const history = [
    Logic.normalizeEntry({ id: 1, app: "Mail", summary: "Invoice", timestamp: 10 }, false, -1),
    Logic.normalizeEntry({ id: 2, app: "Chat", summary: "Hello", timestamp: 20 }, false, -1)
  ]
  const live = [
    Logic.normalizeEntry({ id: 2, app: "Chat", summary: "Hello", timestamp: 21 }, true, 0)
  ]
  const merged = Logic.mergeRows(history, live, { "id:1": true }, "")
  assert.equal(merged.length, 1)
  assert.equal(merged[0].isLive, true)
  assert.equal(Logic.mergeRows(history, [], {}, "inv").length, 1)
  assert.equal(Logic.mergeRows(history, [], {}, "zzz").length, 0)
})

test("day headers split Today and Yesterday", () => {
  const now = Date.parse("2026-09-08T12:00:00")
  const rows = [
    Logic.normalizeEntry({ id: 1, summary: "A", timestamp: now }, false, -1),
    Logic.normalizeEntry({ id: 2, summary: "B", timestamp: now - 86400000 }, false, -1)
  ]
  const grouped = Logic.withDayHeaders(rows, now)
  assert.equal(grouped[0].type, "header")
  assert.equal(grouped[0].label, "Today")
  assert.equal(grouped[2].type, "header")
  assert.equal(grouped[2].label, "Yesterday")
})

test("formatTimestamp uses relative minutes then clock time", () => {
  const now = Date.parse("2026-09-08T12:00:00")
  assert.equal(Logic.formatTimestamp(now - 1000, now), "now")
  assert.equal(Logic.formatTimestamp(now - 120000, now), "2m")
  assert.equal(Logic.formatTimestamp(now - 3600000, now), "11:00")
})

test("gesture line parser and snap decision", () => {
  assert.equal(Logic.parseGestureLine("hello"), null)
  const event = Logic.parseGestureLine('{"phase":"end","kind":"open","amount":0.4,"velocity":0.1}')
  assert.equal(event.kind, "open")
  assert.equal(Logic.snapDecision(0.4, 0.1, "open"), "open")
  assert.equal(Logic.snapDecision(0.1, 0.1, "open"), "cancel")
  assert.equal(Logic.snapDecision(0.15, 1.0, "close"), "close")
  assert.equal(Logic.applyGestureProgress(false, "open", 0.4), 0.4)
  assert.equal(Logic.applyGestureProgress(true, "close", 0.25), 0.75)
})

test("barInsets clear the bar edge completely and ignore the other three", () => {
  assert.deepEqual(
    Logic.barInsets("top", false, 26, 0, [0, 32, 0, 0]),
    { top: 32, right: 0, bottom: 0, left: 0 }
  )
  assert.deepEqual(
    Logic.barInsets("right", false, 28, 0, [0, 0, 40, 0]),
    { top: 0, right: 40, bottom: 0, left: 0 }
  )
  assert.deepEqual(
    Logic.barInsets("bottom", false, 26, 0, null),
    { top: 0, right: 0, bottom: 26, left: 0 }
  )
  assert.deepEqual(
    Logic.barInsets("left", false, 28, 0, { left: 30, top: 0, right: 0, bottom: 0 }),
    { top: 0, right: 0, bottom: 0, left: 30 }
  )
  assert.deepEqual(
    Logic.barInsets("top", true, 26, 32, [0, 32, 0, 0]),
    { top: 0, right: 0, bottom: 0, left: 0 }
  )
})

test("reservedForMonitor picks the named output", () => {
  const raw = JSON.stringify([
    { name: "DP-1", reserved: [1, 2, 3, 4] },
    { name: "eDP-1", reserved: [0, 32, 0, 0] }
  ])
  assert.deepEqual(Logic.parseReserved(Logic.reservedForMonitor(raw, "eDP-1")), {
    left: 0, top: 32, right: 0, bottom: 0
  })
})

test("historyKey prefers id and imageStem uses timestamp-originalId", () => {
  assert.equal(Logic.historyKey({ id: 7, app: "X" }), "id:7")
  assert.equal(Logic.imageStem({ timestamp: 9, originalId: 3 }), "9-3")
})

test("imageStem refuses path-like originalId values", () => {
  assert.equal(Logic.imageStem({ timestamp: 9, originalId: "../etc/passwd" }), "")
  assert.equal(Logic.imageStem({ timestamp: "12;rm", originalId: 4 }), "")
  assert.equal(Logic.imageStem({ timestamp: 1, originalId: "2-3; id" }), "")
  assert.match(Logic.imageStem({ timestamp: 1700000000000, originalId: 42 }), /^[0-9]+-[0-9]+$/)
})

test("history deletion args stay inside Omarchy notification state", () => {
  const home = "/home/box"
  const hist = home + "/.local/state/omarchy/notifications/history"
  const imgs = home + "/.local/state/omarchy/notifications/images"
  const row = { timestamp: 9, originalId: 3 }
  const args = Logic.historyDeleteArgs(hist, imgs, row, home)
  assert.ok(args)
  assert.equal(args[0], "/usr/bin/bash")
  assert.equal(args[args.length - 3], hist)
  assert.equal(args[args.length - 2], "9-3")
  assert.equal(args[args.length - 1], imgs)
  assert.ok(!args.some((part) => String(part).includes("*")))
  assert.equal(Logic.historyDeleteArgs(hist + "/../", imgs, row, home), null)
  assert.equal(Logic.historyDeleteArgs("/tmp/history", imgs, row, home), null)
  assert.equal(Logic.historyDeleteArgs(hist, imgs, { timestamp: 1, originalId: "../x" }, home), null)
  assert.ok(Logic.historyReadArgs(hist, home))
  assert.equal(Logic.historyReadArgs("/tmp", home), null)
})

test("notification icons only follow imagesDir file copies or image://", () => {
  const home = "/home/box"
  const imgs = home + "/.local/state/omarchy/notifications/images"
  assert.equal(
    Logic.notificationIconSource("file://" + imgs + "/9-3-appIcon", imgs, home),
    "file://" + imgs + "/9-3-appIcon"
  )
  assert.equal(Logic.notificationIconSource("file:///etc/passwd", imgs, home), "")
  assert.equal(Logic.notificationIconSource("file://" + imgs + "/../history/x.json", imgs, home), "")
  assert.equal(Logic.notificationIconSource("http://evil.example/x.png", imgs, home), "")
  assert.equal(Logic.notificationIconSource("image://notification/1", imgs, home), "image://notification/1")
  assert.equal(Logic.notificationIconSource("image://notification/../x", imgs, home), "")
  assert.equal(Logic.focusAppArgs("/usr/share/omarchy", "Slack")[1], "Slack")
  assert.equal(Logic.focusAppArgs("/usr/share/omarchy", "-oProxyCommand=x"), null)
  assert.equal(Logic.focusAppArgs("/usr/share/omarchy", "foo; rm -rf /"), null)
  assert.equal(Logic.focusAppArgs("/tmp", "Slack"), null)
  assert.equal(Logic.focusAppArgs("/tmp/omarchy-evil", "Slack"), null)
  assert.equal(Logic.focusAppArgs("/usr/share/omarchy-extra", "Slack"), null)
  assert.deepEqual(
    Logic.gestureCommand("/home/box/.config/omarchy/plugins/blusyn.notification-slideover"),
    [
      "/usr/bin/setpriv", "--pdeathsig", "TERM", "/usr/bin/python3", "-I", "-u",
      "/home/box/.config/omarchy/plugins/blusyn.notification-slideover/gesture.py"
    ]
  )
  assert.deepEqual(Logic.gestureCommand("/tmp/../etc"), [])
})

test("gesture parser rejects oversized lines and clamps amount and velocity", () => {
  assert.equal(Logic.parseGestureLine("x".repeat(300)), null)
  const huge = Logic.parseGestureLine('{"phase":"end","kind":"open","amount":4,"velocity":99}')
  assert.equal(huge.amount, 1)
  assert.equal(huge.velocity, Logic.MAX_VELOCITY)
  const neg = Logic.parseGestureLine('{"phase":"update","kind":"close","amount":-2,"velocity":-40}')
  assert.equal(neg.amount, 0)
  assert.equal(neg.velocity, -Logic.MAX_VELOCITY)
  assert.equal(Logic.parseGestureLine("{not json"), null)
})

test("gesture stream assembler caps a line before SplitParser can grow it", () => {
  const open = '{"phase":"end","kind":"open","amount":0.4,"velocity":0.1}\n'
  let state = Logic.emptyGestureBuffer()
  state = Logic.consumeGestureChunk(state, open.slice(0, 10))
  assert.equal(state.lines.length, 0)
  state = Logic.consumeGestureChunk(state, open.slice(10))
  assert.equal(state.lines.length, 1)
  assert.equal(Logic.parseGestureLine(state.lines[0]).kind, "open")

  const overflow = Logic.consumeGestureChunk(Logic.emptyGestureBuffer(), "x".repeat(300) + "\n" + open)
  assert.equal(overflow.skip, false)
  assert.equal(overflow.lines.length, 1)
  assert.equal(Logic.parseGestureLine(overflow.lines[0]).kind, "open")

  const noNewline = Logic.consumeGestureChunk(Logic.emptyGestureBuffer(), "x".repeat(300))
  assert.equal(noNewline.skip, true)
  assert.equal(noNewline.text, "")
  assert.equal(noNewline.lines.length, 0)
  const after = Logic.consumeGestureChunk(noNewline, "still-going\n" + open)
  assert.equal(after.skip, false)
  assert.equal(after.lines.length, 1)
  assert.ok(after.text.length <= Logic.MAX_GESTURE_LINE)
})

test("normalizeEntry caps untrusted strings and strips img tags", () => {
  const row = Logic.normalizeEntry({
    id: "7",
    originalId: "7",
    app: "<b>Mail</b>",
    summary: "Hi <img src=\"http://x\">",
    body: "hello <img src=\"http://x\"> world",
    glyph: "\u0007A",
    timestamp: "100"
  }, false, -1)
  assert.equal(row.id, 7)
  assert.equal(row.timestamp, 100)
  assert.equal(row.body, "hello  world")
  assert.ok(!row.summary.includes("<img"))
  assert.ok(!row.glyph.includes("\u0007"))
  assert.ok(row.app.length <= 64)
})
