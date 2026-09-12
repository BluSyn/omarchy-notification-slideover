// Pure helpers for the slide-over notification sheet. No QML, no I/O —
// node --test can require this file directly.

var MAX_APP = 64
var MAX_SUMMARY = 200
var MAX_BODY = 2000
var MAX_GLYPH = 16
var MAX_ICON = 512
var MAX_HISTORY_LINE = 16384
var MAX_GESTURE_LINE = 256
var MAX_VELOCITY = 8
var MAX_QUERY = 120
var STEM_RE = /^[0-9]{1,16}-[0-9]{1,16}$/
var IMAGE_FILE_RE = /^[0-9]{1,16}-[0-9]{1,16}-(appIcon|image)$/
var APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/
var THEME_ICON_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
var PLUGIN_FILE_RE = /^[A-Za-z0-9._-]+$/

function stripTrailingSlashes(path) {
  var value = String(path || "")
  while (value.length > 1 && value.charAt(value.length - 1) === "/")
    value = value.slice(0, -1)
  return value
}

function parseDigits(value) {
  if (typeof value === "number") {
    if (!isFinite(value) || value < 0 || value > 9007199254740991) return null
    return Math.floor(value)
  }
  var text = String(value === undefined || value === null ? "" : value)
  if (!/^[0-9]{1,16}$/.test(text)) return null
  return Number(text)
}

function numericId(value) {
  var parsed = parseDigits(value)
  return parsed === null ? 0 : parsed
}

function plainField(value, maxLen) {
  var limit = maxLen === undefined ? 200 : Number(maxLen)
  if (!isFinite(limit) || limit < 0) limit = 200
  var text = String(value || "")
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
  text = text.replace(/[<>&]/g, "")
  if (text.length > limit) text = text.slice(0, limit)
  return text
}

function confinedStateDir(path, home, leaf) {
  if (leaf !== "history" && leaf !== "images") return ""
  var raw = stripTrailingSlashes(path)
  var homePath = stripTrailingSlashes(home)
  if (!raw || !homePath) return ""
  if (raw.charAt(0) !== "/" || homePath.charAt(0) !== "/") return ""
  if (raw.indexOf("\0") >= 0 || homePath.indexOf("\0") >= 0) return ""
  if (raw.indexOf("..") >= 0 || homePath.indexOf("..") >= 0) return ""
  var expected = homePath + "/.local/state/omarchy/notifications/" + leaf
  return raw === expected ? raw : ""
}

function confinedPluginFile(pluginDir, name) {
  var dir = stripTrailingSlashes(pluginDir)
  if (!dir || dir.charAt(0) !== "/") return ""
  if (dir.indexOf("\0") >= 0 || dir.indexOf("..") >= 0) return ""
  if (!PLUGIN_FILE_RE.test(String(name || ""))) return ""
  return dir + "/" + name
}

function confinedOmarchyBin(omarchyPath, name) {
  if (name !== "omarchy-hyprland-focus-app") return ""
  var root = stripTrailingSlashes(omarchyPath)
  if (!root || root.charAt(0) !== "/") return ""
  if (root.indexOf("\0") >= 0 || root.indexOf("..") >= 0) return ""
  var slash = root.lastIndexOf("/")
  if (slash < 1) return ""
  if (root.slice(slash + 1) !== "omarchy") return ""
  return root + "/bin/" + name
}

function isThemeIconName(name) {
  var value = String(name || "")
  if (!THEME_ICON_RE.test(value)) return false
  if (value.indexOf("..") >= 0) return false
  return true
}

function safeAppName(app) {
  var name = plainField(app, MAX_APP).trim()
  if (!APP_NAME_RE.test(name)) return ""
  if (name.indexOf("..") >= 0) return ""
  return name
}

function imageStem(row) {
  var e = row || {}
  var ts = parseDigits(e.timestamp)
  var oidSource = e.originalId !== undefined && e.originalId !== null ? e.originalId : e.id
  var oid = parseDigits(oidSource)
  if (ts === null || oid === null) return ""
  var stem = String(ts) + "-" + String(oid)
  return STEM_RE.test(stem) ? stem : ""
}

function historyDeleteArgs(historyDir, imagesDir, row, home) {
  var hist = confinedStateDir(historyDir, home, "history")
  var imgs = confinedStateDir(imagesDir, home, "images")
  var stem = imageStem(row)
  if (!hist || !imgs || !stem) return null
  return [
    "/usr/bin/bash", "-c",
    "rm -f -- \"$1/$2.json\" \"$3/$2-appIcon\" \"$3/$2-image\"",
    "--", hist, stem, imgs
  ]
}

function historyReadArgs(historyDir, home) {
  var hist = confinedStateDir(historyDir, home, "history")
  if (!hist) return null
  return [
    "/usr/bin/bash", "-c",
    "LC_ALL=C\n" +
    "out=$(/usr/bin/timeout -k 2 -- 8 /usr/bin/awk 1 \"$1\"/*.json 2>/dev/null | /usr/bin/head -c 262145)\n" +
    "[ ${#out} -le 262144 ] || exit 0\n" +
    "printf '%s' \"$out\"",
    "--", hist
  ]
}

function reservedMonitorsArgs() {
  return [
    "/usr/bin/bash", "-c",
    "LC_ALL=C\n" +
    "out=$(/usr/bin/timeout -k 2 -- 5 /usr/bin/hyprctl -j monitors | /usr/bin/head -c 65537)\n" +
    "[ ${#out} -le 65536 ] || exit 0\n" +
    "printf '%s' \"$out\""
  ]
}

function gestureCommand(pluginDir) {
  var script = confinedPluginFile(pluginDir, "gesture.py")
  if (!script) return []
  return ["/usr/bin/setpriv", "--pdeathsig", "TERM", "/usr/bin/python3", "-I", "-u", script]
}

function focusAppArgs(omarchyPath, app) {
  var bin = confinedOmarchyBin(omarchyPath, "omarchy-hyprland-focus-app")
  var name = safeAppName(app)
  if (!bin || !name) return null
  return [bin, name]
}

function maxGestureLine() { return MAX_GESTURE_LINE }
function maxQuery() { return MAX_QUERY }

function isChromiumDerived(app, appIcon) {
  var source = (String(app || "") + "\n" + String(appIcon || "")).toLowerCase()
  return source.indexOf("chrom") >= 0 || source.indexOf("brave") >= 0 ||
         source.indexOf("vivaldi") >= 0 || source.indexOf("microsoft-edge") >= 0 ||
         source.indexOf("opera") >= 0
}

function isImageTag(tag) {
  var name = /^<[^A-Za-z0-9]*([A-Za-z0-9]+)/.exec(tag)
  return !!name && name[1].toLowerCase() === "img"
}

function stripImageTags(text) {
  var out = ""
  var i = 0
  var source = String(text || "")
  while (i < source.length) {
    var open = source.indexOf("<", i)
    if (open === -1) {
      out += source.slice(i)
      break
    }
    out += source.slice(i, open)
    var close = source.indexOf(">", open)
    var tag = close === -1 ? source.slice(open) : source.slice(open, close + 1)
    if (!isImageTag(tag)) out += tag
    i = close === -1 ? source.length : close + 1
  }
  return out
}

function sanitizeBody(body, app, appIcon) {
  var text = stripImageTags(String(body || ""))
  if (isChromiumDerived(app, appIcon)) {
    text = text
      .replace(/^\s*<a\b[^>]*>\s*(?:https?:\/\/|www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^<\s]*)?\s*<\/a>\s*/i, "")
      .replace(/^\s*(?:https?:\/\/|www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?\s+/i, "")
  }
  return plainField(text, MAX_BODY)
}

function glyphFromHints(hints) {
  try {
    if (hints) {
      var glyph = hints["omarchy-glyph"]
      if (glyph !== undefined && glyph !== null) return String(glyph)
    }
  } catch (e) {
  }
  return ""
}

function historyKey(row) {
  if (!row) return "k:"
  if (row.id !== undefined && row.id !== null && row.id !== "" && row.id !== 0)
    return "id:" + row.id
  return "k:" + String(row.app || "") + "|" + String(row.summary || "") + "|" + String(row.timestamp || 0)
}

function parseHistoryFiles(raw, cap) {
  var limit = cap === undefined || cap === null ? 30 : Number(cap)
  if (isNaN(limit)) limit = 30
  limit = Math.max(0, Math.min(50, limit))
  var source = String(raw || "")
  if (source.length > 262144) source = source.slice(0, 262144)
  var lines = source.split("\n")
  var parsed = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line || line.length > MAX_HISTORY_LINE) continue
    try {
      var value = JSON.parse(line)
      if (!value || typeof value !== "object") continue
      parsed.push(normalizeEntry(value, false, -1))
    } catch (e) {
      // Torn write — skip the line, keep the rest.
    }
  }
  parsed.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0) })
  return parsed.slice(0, limit)
}

function normalizeEntry(value, isLive, sourceIndex) {
  var v = value || {}
  var id = numericId(v.id !== undefined ? v.id : v.originalId)
  var originalId = numericId(v.originalId !== undefined ? v.originalId : id)
  var urgency = Number(v.urgency === undefined ? 1 : v.urgency)
  if (!isFinite(urgency)) urgency = 1
  if (urgency < 0) urgency = 0
  if (urgency > 2) urgency = 2
  return {
    type: "row",
    sourceIndex: sourceIndex === undefined ? -1 : sourceIndex,
    isLive: !!isLive,
    id: id,
    originalId: originalId,
    app: plainField(v.appName || v.app || "Unknown", MAX_APP),
    appIcon: plainField(v.appIcon || "", MAX_ICON),
    summary: plainField(v.summary || "Notification", MAX_SUMMARY),
    body: sanitizeBody(v.body || "", v.appName || v.app, v.appIcon),
    image: plainField(v.image || "", MAX_ICON),
    glyph: plainField(v.glyph || glyphFromHints(v.hints), MAX_GLYPH),
    urgency: urgency,
    timestamp: numericId(v.timestamp)
  }
}

function liveRowsFromModel(model) {
  var rows = []
  if (!model || typeof model.count !== "number") return rows
  for (var i = 0; i < model.count; i++) {
    var row = model.get(i)
    if (!row) continue
    if (row.originalId !== undefined && Number(row.originalId) < 0) continue
    rows.push(normalizeEntry(row, true, i))
  }
  return rows
}

function mergeRows(historyRows, live, hiddenKeys, query) {
  var hidden = hiddenKeys || {}
  var rows = []
  var seen = {}
  function take(row) {
    if (!row) return
    var key = historyKey(row)
    if (hidden[key]) return
    if (seen[key]) return
    if (!rowMatches(row, query)) return
    seen[key] = true
    rows.push(row)
  }
  var liveRows = Array.isArray(live) ? live : []
  for (var i = 0; i < liveRows.length; i++) take(liveRows[i])
  var hist = Array.isArray(historyRows) ? historyRows : []
  for (var h = 0; h < hist.length; h++) take(hist[h])
  rows.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0) })
  return rows
}

function rowMatches(row, query) {
  var needle = String(query || "").trim().toLowerCase()
  if (!needle) return true
  var haystack = [row.app, row.summary, row.body].join(" ").toLowerCase()
  return haystack.indexOf(needle) >= 0
}

function startOfDay(ms) {
  var d = new Date(Number(ms) || 0)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayLabel(ms, nowMs) {
  var that = startOfDay(ms)
  var today = startOfDay(nowMs === undefined ? Date.now() : nowMs)
  var diff = Math.round((today - that) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  var date = new Date(Number(ms) || 0)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function withDayHeaders(rows, nowMs) {
  var out = []
  var last = ""
  var source = Array.isArray(rows) ? rows : []
  for (var i = 0; i < source.length; i++) {
    var row = source[i]
    var key = String(startOfDay(row.timestamp))
    if (key !== last) {
      last = key
      out.push({
        type: "header",
        id: "h:" + key,
        label: dayLabel(row.timestamp, nowMs)
      })
    }
    out.push(row)
  }
  return out
}

function formatTimestamp(ms, nowMs) {
  var ts = Number(ms) || 0
  var now = nowMs === undefined ? Date.now() : Number(nowMs)
  var date = new Date(ts)
  var delta = Math.max(0, now - ts)
  if (delta < 45000) return "now"
  if (delta < 3600000) return Math.round(delta / 60000) + "m"
  if (startOfDay(ts) === startOfDay(now)) {
    var hours = date.getHours()
    var minutes = date.getMinutes()
    return (hours < 10 ? "0" : "") + hours + ":" + (minutes < 10 ? "0" : "") + minutes
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function notificationIconSource(icon, imagesDir, home) {
  var value = String(icon || "")
  if (value.length === 0 || value.length > MAX_ICON) return ""
  if (value.indexOf("image://") === 0) {
    if (value.indexOf("..") >= 0 || value.indexOf("\0") >= 0) return ""
    return value
  }
  var filePath = ""
  if (value.indexOf("file://") === 0) {
    filePath = value.slice(7)
    try { filePath = decodeURIComponent(filePath) } catch (e) { return "" }
  } else if (value.charAt(0) === "/") {
    filePath = value
  } else {
    return ""
  }
  var root = confinedStateDir(imagesDir, home, "images")
  if (!root || !filePath) return ""
  if (filePath.indexOf("\0") >= 0 || filePath.indexOf("..") >= 0) return ""
  if (filePath.indexOf(root + "/") !== 0) return ""
  var rest = filePath.slice(root.length + 1)
  if (!IMAGE_FILE_RE.test(rest)) return ""
  return "file://" + root + "/" + rest
}

function emptyGestureBuffer() {
  return { text: "", skip: false }
}

// SplitParser has no line cap. Assemble newline-delimited frames here so an
// oversized write without a newline cannot grow past MAX_GESTURE_LINE.
function consumeGestureChunk(state, chunk, maxLine) {
  var limit = maxLine === undefined ? MAX_GESTURE_LINE : Number(maxLine)
  if (!isFinite(limit) || limit < 1) limit = MAX_GESTURE_LINE
  var buf = state && typeof state === "object" ? state : emptyGestureBuffer()
  var text = String(buf.text || "")
  var skip = !!buf.skip
  var incoming = String(chunk || "")
  var lines = []
  var i = 0
  while (i < incoming.length) {
    if (skip) {
      var skipNl = incoming.indexOf("\n", i)
      if (skipNl === -1) return { text: "", skip: true, lines: lines }
      skip = false
      text = ""
      i = skipNl + 1
      continue
    }
    var nl = incoming.indexOf("\n", i)
    var end = nl === -1 ? incoming.length : nl
    var room = limit - text.length
    var take = end - i
    if (take > room) {
      skip = true
      text = ""
      i = i + room
      continue
    }
    text += incoming.slice(i, end)
    if (nl === -1) return { text: text, skip: false, lines: lines }
    if (text.length) lines.push(text)
    text = ""
    i = nl + 1
  }
  return { text: text, skip: skip, lines: lines }
}

function parseGestureLine(raw) {
  var text = String(raw || "").trim()
  if (!text || text.length > MAX_GESTURE_LINE || text.charAt(0) !== "{") return null
  try {
    var value = JSON.parse(text)
    if (!value || typeof value !== "object") return null
    var phase = String(value.phase || "")
    if (phase !== "begin" && phase !== "update" && phase !== "end" && phase !== "cancel")
      return null
    var kind = String(value.kind || "")
    if (kind !== "open" && kind !== "close") return null
    var amount = Number(value.amount)
    if (!isFinite(amount)) amount = 0
    if (amount < 0) amount = 0
    if (amount > 1) amount = 1
    var velocity = Number(value.velocity)
    if (!isFinite(velocity)) velocity = 0
    if (velocity > MAX_VELOCITY) velocity = MAX_VELOCITY
    if (velocity < -MAX_VELOCITY) velocity = -MAX_VELOCITY
    return { phase: phase, kind: kind, amount: amount, velocity: velocity }
  } catch (e) {
    return null
  }
}

function snapDecision(amount, velocity, kind) {
  var a = Number(amount)
  var v = Number(velocity)
  if (!isFinite(a)) a = 0
  if (!isFinite(v)) v = 0
  var commit = a >= 0.28 || (a >= 0.12 && v >= 0.85)
  if (!commit) return "cancel"
  return kind === "close" ? "close" : "open"
}

function parseReserved(value) {
  var out = { left: 0, top: 0, right: 0, bottom: 0 }
  if (Array.isArray(value) && value.length >= 4) {
    out.left = Math.max(0, Number(value[0]) || 0)
    out.top = Math.max(0, Number(value[1]) || 0)
    out.right = Math.max(0, Number(value[2]) || 0)
    out.bottom = Math.max(0, Number(value[3]) || 0)
    return out
  }
  if (value && typeof value === "object") {
    out.left = Math.max(0, Number(value.left) || 0)
    out.top = Math.max(0, Number(value.top) || 0)
    out.right = Math.max(0, Number(value.right) || 0)
    out.bottom = Math.max(0, Number(value.bottom) || 0)
  }
  return out
}

function reservedForMonitor(raw, screenName) {
  try {
    var monitors = JSON.parse(String(raw || "[]"))
    if (!Array.isArray(monitors) || monitors.length === 0) return null
    var want = String(screenName || "")
    for (var i = 0; i < monitors.length; i++) {
      var mon = monitors[i]
      if (!mon) continue
      if (!want || String(mon.name || "") === want) return mon.reserved
    }
    return monitors[0] ? monitors[0].reserved : null
  } catch (e) {
    return null
  }
}

function barInsets(position, hidden, barSize, notchHeight, reserved) {
  if (hidden) return { top: 0, right: 0, bottom: 0, left: 0 }
  var pos = String(position || "top")
  if (pos !== "top" && pos !== "bottom" && pos !== "left" && pos !== "right") pos = "top"
  var fallback = Math.max(0, Number(barSize) || 0)
  if (pos === "top") fallback = Math.max(fallback, Math.max(0, Number(notchHeight) || 0))
  var r = parseReserved(reserved)
  return {
    top: pos === "top" ? Math.max(fallback, r.top) : 0,
    right: pos === "right" ? Math.max(fallback, r.right) : 0,
    bottom: pos === "bottom" ? Math.max(fallback, r.bottom) : 0,
    left: pos === "left" ? Math.max(fallback, r.left) : 0
  }
}

function applyGestureProgress(opened, kind, amount) {
  var a = Number(amount)
  if (!isFinite(a)) a = 0
  a = Math.max(0, Math.min(1, a))
  if (kind === "close") return Math.max(0, Math.min(1, 1 - a))
  if (kind === "open") return a
  return opened ? 1 : 0
}

if (typeof module !== "undefined") {
  module.exports = {
    MAX_GESTURE_LINE: MAX_GESTURE_LINE,
    MAX_VELOCITY: MAX_VELOCITY,
    MAX_QUERY: MAX_QUERY,
    maxGestureLine: maxGestureLine,
    maxQuery: maxQuery,
    isChromiumDerived: isChromiumDerived,
    stripImageTags: stripImageTags,
    sanitizeBody: sanitizeBody,
    plainField: plainField,
    numericId: numericId,
    glyphFromHints: glyphFromHints,
    historyKey: historyKey,
    parseHistoryFiles: parseHistoryFiles,
    normalizeEntry: normalizeEntry,
    liveRowsFromModel: liveRowsFromModel,
    mergeRows: mergeRows,
    rowMatches: rowMatches,
    startOfDay: startOfDay,
    dayLabel: dayLabel,
    withDayHeaders: withDayHeaders,
    formatTimestamp: formatTimestamp,
    imageStem: imageStem,
    confinedStateDir: confinedStateDir,
    confinedPluginFile: confinedPluginFile,
    historyDeleteArgs: historyDeleteArgs,
    historyReadArgs: historyReadArgs,
    reservedMonitorsArgs: reservedMonitorsArgs,
    gestureCommand: gestureCommand,
    focusAppArgs: focusAppArgs,
    safeAppName: safeAppName,
    isThemeIconName: isThemeIconName,
    notificationIconSource: notificationIconSource,
    emptyGestureBuffer: emptyGestureBuffer,
    consumeGestureChunk: consumeGestureChunk,
    parseGestureLine: parseGestureLine,
    snapDecision: snapDecision,
    applyGestureProgress: applyGestureProgress,
    parseReserved: parseReserved,
    reservedForMonitor: reservedForMonitor,
    barInsets: barInsets
  }
}
