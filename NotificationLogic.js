// Pure helpers for the slide-over notification sheet. No QML, no I/O —
// node --test can require this file directly.

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
  if (!isChromiumDerived(app, appIcon)) return text
  return text
    .replace(/^\s*<a\b[^>]*>\s*(?:https?:\/\/|www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^<\s]*)?\s*<\/a>\s*/i, "")
    .replace(/^\s*(?:https?:\/\/|www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?\s+/i, "")
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
  limit = Math.max(0, limit)
  var lines = String(raw || "").split("\n")
  var parsed = []
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (!line) continue
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
  var id = v.id !== undefined ? v.id : (v.originalId !== undefined ? v.originalId : null)
  var originalId = v.originalId !== undefined ? v.originalId : id
  return {
    type: "row",
    sourceIndex: sourceIndex === undefined ? -1 : sourceIndex,
    isLive: !!isLive,
    id: id,
    originalId: originalId,
    app: String(v.appName || v.app || "Unknown"),
    appIcon: String(v.appIcon || ""),
    summary: String(v.summary || "Notification"),
    body: String(v.body || ""),
    image: String(v.image || ""),
    glyph: String(v.glyph || glyphFromHints(v.hints)),
    urgency: Number(v.urgency === undefined ? 1 : v.urgency),
    timestamp: Number(v.timestamp || 0)
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

function imageStem(row) {
  var e = row || {}
  return String(e.timestamp || 0) + "-" + String(e.originalId || e.id || 0)
}

function notificationIconSource(icon) {
  var value = String(icon || "")
  if (value.length === 0) return ""
  if (value.indexOf("file://") === 0 || value.indexOf("image://") === 0) return value
  if (value.charAt(0) === "/") return "file://" + value
  return ""
}

function parseGestureLine(raw) {
  var text = String(raw || "").trim()
  if (!text || text.charAt(0) !== "{") return null
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
    isChromiumDerived: isChromiumDerived,
    stripImageTags: stripImageTags,
    sanitizeBody: sanitizeBody,
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
    notificationIconSource: notificationIconSource,
    parseGestureLine: parseGestureLine,
    snapDecision: snapDecision,
    applyGestureProgress: applyGestureProgress,
    parseReserved: parseReserved,
    reservedForMonitor: reservedForMonitor,
    barInsets: barInsets
  }
}
