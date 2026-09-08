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
