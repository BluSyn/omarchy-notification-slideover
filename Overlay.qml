pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "NotificationLogic.js" as NotificationLogic

Item {
  id: root

  property var shell: null
  property var manifest: null
  property string omarchyPath: Quickshell.env("OMARCHY_PATH")

  property bool opened: false
  property real progress: 0
  property bool gestureActive: false
  property bool sheetBusy: false
  property string gestureKind: ""
  property bool edgeDragging: false
  property real edgeDragOrigin: 0
  property real edgeDragStartProgress: 0

  property string query: ""
  property var historyRows: []
  property var filteredDisplay: []
  property int matchCount: 0
  property var hiddenHistoryKeys: ({})
  property var now: new Date()
  property var gestureBuf: ({ text: "", skip: false })

  readonly property string pluginId: (manifest && manifest.id) || "blusyn.notification-slideover"
  readonly property string pluginDir: (manifest && manifest.__sourceDir) || ""
  readonly property string homeDir: String(Quickshell.env("HOME") || "")
  readonly property string gestureScript: NotificationLogic.confinedPluginFile(root.pluginDir, "gesture.py")

  readonly property var notificationService: shell && shell.firstPartyServiceFor
    ? shell.firstPartyServiceFor("omarchy.notifications") : null
  readonly property int liveCount: notificationService && notificationService.popupModel
    ? notificationService.popupModel.count : 0
  readonly property string historyDir: notificationService && notificationService.historyDir
    ? String(notificationService.historyDir) : ""
  readonly property string imagesDir: notificationService && notificationService.imagesDir
    ? String(notificationService.imagesDir) : ""
  readonly property int historyLimit: notificationService && notificationService.historyLimit
    ? Number(notificationService.historyLimit) : 10

  readonly property bool dndSupported: !!notificationService
    && typeof notificationService.doNotDisturb === "boolean"
    && typeof notificationService.setDoNotDisturb === "function"
  readonly property bool dndOn: dndSupported && notificationService.doNotDisturb

  readonly property var bar: shell && shell.bar ? shell.bar : null
  readonly property string barPosition: shell && shell.barConfig ? String(shell.barConfig.position || "top") : "top"
  readonly property bool barVertical: barPosition === "left" || barPosition === "right"
  readonly property int defaultBarSize: barVertical ? Style.bar.sizeVertical : Style.bar.sizeHorizontal
  readonly property int liveBarSize: bar && !bar.barHidden ? Math.max(0, bar.barSize) : defaultBarSize
  readonly property bool barTransparent: !bar || bar.transparent === true

  readonly property bool fullyOpen: opened && progress >= 0.995
  readonly property bool sheetVisible: progress > 0.004 || edgeDragging || gestureActive

  readonly property string fontFamily: Style.font.menuFamily
  readonly property color colForeground: Color.foreground
  readonly property color colDim: Qt.darker(Color.foreground, 1.45)
  readonly property color colAccent: Color.accent
  readonly property color colUrgent: Color.urgent
  readonly property color colBorder: Color.menu.border
  // Stay on the theme background, but pull it toward black (dark themes) or
  // white (light themes) so type still reads when a busy window is behind.
  readonly property bool darkTheme: {
    var c = Color.background
    return (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722) < 0.5
  }
  readonly property color sheetInk: root.darkTheme ? Qt.rgba(0, 0, 0, 1) : Qt.rgba(1, 1, 1, 1)
  readonly property color sheetSolid: Qt.tint(Color.background, Util.alpha(root.sheetInk, 0.34))
  readonly property real sheetAlpha: barTransparent ? 0.98 : 0.99
  readonly property color sheetColor: Util.alpha(root.sheetSolid, root.sheetAlpha)
  readonly property int cardRadius: notificationService && notificationService.cornerRadius
    ? notificationService.cornerRadius : Style.cornerRadius
  readonly property int sheetWidth: {
    var w = panel.width || 0
    var target = Style.space(380)
    if (w <= 0) return target
    return Math.max(Style.space(320), Math.min(target, Math.round(w * 0.34)))
  }
  readonly property int edgeWidth: Style.space(12)
  // Compositor exclusive zone on the bar's edge. bar.barSize is the style
  // token and is short of the notched Apple bar, which is what made the
  // sheet nibble a few pixels of the menu. Hyprland's reserved inset is the
  // real occupied strip for top/bottom/left/right bars.
  property int insetTop: 0
  property int insetRight: 0
  property int insetBottom: 0
  property int insetLeft: 0

  function applyInsets(reserved) {
    var next = NotificationLogic.barInsets(
      root.barPosition,
      !root.bar || root.bar.barHidden,
      root.liveBarSize,
      Style.bar.notchHeight,
      reserved
    )
    root.insetTop = next.top
    root.insetRight = next.right
    root.insetBottom = next.bottom
    root.insetLeft = next.left
  }

  function refreshInsets() {
    if (reservedProc.running) return
    reservedProc.running = true
  }

  function open(payloadJson) {
    root.gestureActive = false
    root.edgeDragging = false
    root.opened = true
    root.progress = 1
    root.clearSearch()
    root.refreshHistory()
    root.rebuildRows()
    root.now = new Date()
    Qt.callLater(function() {
      if (root.fullyOpen) searchField.forceActiveFocus()
    })
  }

  function close() {
    if (root.sheetBusy) return
    root.sheetBusy = true
    root.gestureActive = false
    root.edgeDragging = false
    root.opened = false
    root.progress = 0
    root.query = ""
    Qt.callLater(function() { root.sheetBusy = false })
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  function clearSearch() {
    root.query = ""
    if (searchField.text !== "") searchField.text = ""
  }

  function toggleDnd() {
    if (root.dndSupported) root.notificationService.setDoNotDisturb(!root.notificationService.doNotDisturb)
  }

  function iconSource(icon) {
    var direct = NotificationLogic.notificationIconSource(icon, root.imagesDir, root.homeDir)
    if (direct) return direct
    var value = String(icon || "")
    if (!NotificationLogic.isThemeIconName(value)) return ""
    return Quickshell.iconPath(value, true)
  }

  function rebuildRows() {
    var live = NotificationLogic.liveRowsFromModel(root.notificationService ? root.notificationService.popupModel : null)
    var merged = NotificationLogic.mergeRows(root.historyRows, live, root.hiddenHistoryKeys, root.query)
    root.matchCount = merged.length
    root.filteredDisplay = NotificationLogic.withDayHeaders(merged, Date.now())
  }

  function dismissRow(row) {
    if (!row || row.type === "header") return
    if (row.isLive) {
      if (root.notificationService && typeof root.notificationService.dismissPopup === "function")
        root.notificationService.dismissPopup(row.sourceIndex)
    } else {
      var next = Object.assign({}, root.hiddenHistoryKeys)
      next[NotificationLogic.historyKey(row)] = true
      root.hiddenHistoryKeys = next
      if (root.notificationService && typeof root.notificationService.removeHistoryEntry === "function") {
        root.notificationService.removeHistoryEntry(row.id)
      } else {
        root.deleteHistoryFiles(row)
      }
    }
    root.rebuildRows()
  }

  function deleteHistoryFiles(row) {
    var args = NotificationLogic.historyDeleteArgs(root.historyDir, root.imagesDir, row, root.homeDir)
    if (!args) return
    Quickshell.execDetached(args)
  }

  function activateRow(row) {
    if (!row || row.type === "header") return
    if (row.isLive && root.notificationService && typeof root.notificationService.invokePopupDefault === "function") {
      root.notificationService.invokePopupDefault(row.sourceIndex)
    } else {
      var args = NotificationLogic.focusAppArgs(root.omarchyPath, row.app)
      if (args) Quickshell.execDetached(args)
    }
    root.close()
  }

  function clearAll() {
    if (!root.notificationService) {
      root.historyRows = []
      root.hiddenHistoryKeys = ({})
      root.rebuildRows()
      return
    }
    if (typeof root.notificationService.clearPopups === "function") root.notificationService.clearPopups()
    if (typeof root.notificationService.clearHistory === "function") root.notificationService.clearHistory()
    root.historyRows = []
    root.hiddenHistoryKeys = ({})
    root.rebuildRows()
  }

  function parseHistory(raw) {
    root.historyRows = NotificationLogic.parseHistoryFiles(raw, Math.max(10, root.historyLimit))
    root.rebuildRows()
  }

  function refreshHistory() {
    if (historyReader.running) return
    var args = NotificationLogic.historyReadArgs(root.historyDir, root.homeDir)
    if (!args) return
    historyReader.command = args
    historyReader.running = true
  }

  function snapFromGesture(kind, amount, velocity) {
    var decision = NotificationLogic.snapDecision(amount, velocity, kind)
    root.gestureActive = false
    if (decision === "open") {
      root.opened = true
      root.progress = 1
      root.clearSearch()
      root.refreshHistory()
      root.rebuildRows()
      Qt.callLater(function() { searchField.forceActiveFocus() })
    } else if (decision === "close") {
      root.close()
    } else if (root.opened) {
      root.progress = 1
    } else {
      root.progress = 0
    }
  }

  function handleGestureChunk(chunk) {
    var next = NotificationLogic.consumeGestureChunk(root.gestureBuf, chunk)
    root.gestureBuf = { text: next.text, skip: next.skip }
    var lines = next.lines || []
    for (var i = 0; i < lines.length; i++) root.handleGesture(lines[i])
  }

  function handleGesture(line) {
    if (line === undefined || line === null) return
    if (String(line).length > NotificationLogic.maxGestureLine()) return
    var event = NotificationLogic.parseGestureLine(line)
    if (!event) return
    if (event.kind === "open" && root.opened && root.fullyOpen) return
    if (event.kind === "close" && !root.opened && root.progress <= 0.01 && event.phase !== "end") return

    if (event.phase === "begin" || event.phase === "update") {
      root.gestureActive = true
      root.gestureKind = event.kind
      root.progress = NotificationLogic.applyGestureProgress(root.opened, event.kind, event.amount)
      if (event.phase === "begin" && event.kind === "open") {
        root.refreshHistory()
        root.rebuildRows()
      }
      return
    }

    if (event.phase === "cancel") {
      root.gestureActive = false
      root.progress = root.opened ? 1 : 0
      return
    }

    if (event.phase === "end")
      root.snapFromGesture(event.kind, event.amount, event.velocity)
  }

  function beginEdgeDrag(openDirection, originX) {
    root.edgeDragging = true
    root.gestureActive = true
    root.gestureKind = openDirection ? "open" : "close"
    root.edgeDragOrigin = originX
    root.edgeDragStartProgress = root.progress
    if (openDirection) {
      root.refreshHistory()
      root.rebuildRows()
    }
  }

  function updateEdgeDrag(x) {
    if (!root.edgeDragging) return
    var delta = root.edgeDragOrigin - x
    var span = Math.max(1, root.sheetWidth)
    var next = root.edgeDragStartProgress + delta / span
    if (next < 0) next = 0
    if (next > 1) next = 1
    root.progress = next
  }

  function endEdgeDrag() {
    if (!root.edgeDragging) return
    root.edgeDragging = false
    var amount = root.gestureKind === "close" ? (1 - root.progress) : root.progress
    root.snapFromGesture(root.gestureKind || "open", amount, 0)
  }

  onQueryChanged: rebuildRows()
  onBarPositionChanged: root.refreshInsets()
  onLiveBarSizeChanged: root.refreshInsets()
  onOpenedChanged: {
    if (opened) {
      root.now = new Date()
      root.refreshHistory()
      root.rebuildRows()
      root.refreshInsets()
    }
  }

  Behavior on progress {
    enabled: !root.gestureActive && !root.edgeDragging
    NumberAnimation { duration: 260; easing.type: Easing.OutCubic }
  }

  Timer {
    interval: 15000
    repeat: true
    running: root.sheetVisible
    onTriggered: root.now = new Date()
  }

  Timer {
    interval: 800
    repeat: true
    running: root.sheetVisible
    onTriggered: root.refreshHistory()
  }

  Process {
    id: historyReader
    running: false
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.parseHistory(text)
    }
  }

  Process {
    id: reservedProc
    running: false
    command: NotificationLogic.reservedMonitorsArgs()
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var screenName = panel.screen ? String(panel.screen.name || "") : ""
        root.applyInsets(NotificationLogic.reservedForMonitor(text, screenName))
      }
    }
  }

  Process {
    id: gestureProc
    running: false
    command: NotificationLogic.gestureCommand(root.pluginDir)
    stdout: SplitParser {
      // Empty marker yields OS read chunks instead of unbounded newline
      // buffering. consumeGestureChunk assembles frames and drops anything
      // past MAX_GESTURE_LINE, including a write that never sends a newline.
      splitMarker: ""
      onRead: function(data) { root.handleGestureChunk(data) }
    }
    onExited: {
      root.gestureBuf = { text: "", skip: false }
      // 0 means the watcher is optional and chose to stop (no python-libevdev).
      // Keyboard, mouse-edge drag, and Hyprland binds still open the sheet.
      var code = 1
      try { code = Number(gestureProc.exitCode) } catch (e) { code = 1 }
      if (code === 0) return
      gestureRestart.restart()
    }
  }

  Timer {
    id: gestureRestart
    interval: 1200
    repeat: false
    onTriggered: {
      if (root.gestureScript && !gestureProc.running) gestureProc.running = true
    }
  }

  function startGestureWatcher() {
    if (!root.gestureScript || gestureProc.running) return
    if (!gestureProc.command || gestureProc.command.length === 0) return
    gestureProc.running = true
  }

  onPluginDirChanged: root.startGestureWatcher()
  Component.onCompleted: {
    root.applyInsets(null)
    Qt.callLater(root.startGestureWatcher)
    Qt.callLater(root.refreshInsets)
  }

  Connections {
    target: root.notificationService ? root.notificationService.popupModel : null
    function onCountChanged() { root.rebuildRows() }
    function onDataChanged() { root.rebuildRows() }
    function onRowsInserted() { root.rebuildRows() }
    function onRowsRemoved() { root.rebuildRows() }
    function onModelReset() { root.rebuildRows() }
  }

  IpcHandler {
    target: "notification-slideover"
    // Parameterless only. Do not declare open/close/toggle here: Quickshell
    // attaches IpcHandler methods onto the item, which would shadow the
    // shell's summon/hide contract and recurse until the stack blows.
    function state(): string { return root.opened ? "open" : "closed" }
    function ping(): string { return "ok" }
  }

  PanelWindow {
    id: panel
    visible: true
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    surfaceFormat.opaque: false
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "blusyn-notification-slideover"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: root.fullyOpen ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
    mask: Region {
      item: root.fullyOpen ? contentArea : (root.sheetVisible ? sheet : edgeHit)
    }

    Item {
      id: clickCatcher
      anchors.fill: parent

      // Everything except the Omarchy bar strip. The layer-shell surface is
      // full-screen (so it can sit on Overlay); drawing and hit-testing stay
      // inside this box so the bar is neither covered nor click-blocked.
      Item {
        id: contentArea
        anchors.fill: parent
        anchors.topMargin: root.insetTop
        anchors.rightMargin: root.insetRight
        anchors.bottomMargin: root.insetBottom
        anchors.leftMargin: root.insetLeft
      }

      Rectangle {
        anchors.fill: contentArea
        color: Color.background
        opacity: root.fullyOpen ? 0.22 : 0
        Behavior on opacity { NumberAnimation { duration: 180 } }
      }

      MouseArea {
        anchors.fill: contentArea
        enabled: root.fullyOpen && !root.sheetBusy
        onClicked: if (root.opened && !root.sheetBusy) root.close()
      }

      Item {
        id: edgeHit
        width: root.edgeWidth
        anchors.top: contentArea.top
        anchors.bottom: contentArea.bottom
        anchors.right: contentArea.right

        MouseArea {
          anchors.fill: parent
          hoverEnabled: true
          enabled: !root.fullyOpen
          cursorShape: Qt.SizeHorCursor
          onPressed: function(mouse) { root.beginEdgeDrag(true, mapToItem(clickCatcher, mouse.x, mouse.y).x) }
          onPositionChanged: function(mouse) { root.updateEdgeDrag(mapToItem(clickCatcher, mouse.x, mouse.y).x) }
          onReleased: root.endEdgeDrag()
        }
      }

      Item {
        id: sheet
        width: root.sheetWidth
        height: contentArea.height
        y: contentArea.y
        x: contentArea.x + contentArea.width - width * root.progress
        clip: true

        Rectangle {
          anchors.fill: parent
          color: root.sheetColor
        }

        Rectangle {
          anchors.left: parent.left
          anchors.top: parent.top
          anchors.bottom: parent.bottom
          width: 1
          color: Util.alpha(root.colForeground, 0.22)
        }

        MouseArea {
          anchors.fill: parent
          onClicked: {}
          onPressed: {}
        }

        MouseArea {
          id: handleDrag
          width: Style.space(18)
          anchors.left: parent.left
          anchors.top: parent.top
          anchors.bottom: parent.bottom
          cursorShape: Qt.SizeHorCursor
          enabled: root.sheetVisible
          onPressed: function(mouse) {
            root.beginEdgeDrag(root.progress < 0.5, mapToItem(clickCatcher, mouse.x, mouse.y).x)
          }
          onPositionChanged: function(mouse) {
            root.updateEdgeDrag(mapToItem(clickCatcher, mouse.x, mouse.y).x)
          }
          onReleased: root.endEdgeDrag()
        }

        ColumnLayout {
          id: sheetBody
          anchors.fill: parent
          anchors.margins: Style.space(18)
          anchors.leftMargin: Style.space(22)
          spacing: Style.space(12)

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.space(10)

            ColumnLayout {
              Layout.fillWidth: true
              spacing: Style.space(2)

              Text {
                text: Qt.formatTime(root.now, "HH:mm")
                textFormat: Text.PlainText
                color: root.colForeground
                font.family: root.fontFamily
                font.pixelSize: Style.font.display
                font.bold: true
              }

              Text {
                text: Qt.formatDate(root.now, "dddd, MMMM d")
                textFormat: Text.PlainText
                color: root.colDim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }

            ToggleSwitch {
              visible: root.dndSupported
              checked: root.dndOn
              onToggled: root.toggleDnd()
            }
          }

          RowLayout {
            Layout.fillWidth: true
            spacing: Style.space(8)

            Text {
              text: root.dndOn ? "Do Not Disturb" : (root.liveCount > 0
                ? (root.liveCount === 1 ? "1 new" : root.liveCount + " new")
                : "Notifications")
              textFormat: Text.PlainText
              color: root.dndOn ? root.colAccent : root.colDim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: root.dndOn
              Layout.fillWidth: true
            }

            Text {
              visible: root.matchCount > 0
              text: "Clear"
              textFormat: Text.PlainText
              color: root.colDim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.underline: clearHover.containsMouse
              MouseArea {
                id: clearHover
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: root.clearAll()
              }
            }
          }

          TextField {
            id: searchField
            Layout.fillWidth: true
            placeholderText: "Search"
            maximumLength: NotificationLogic.maxQuery()
            visible: root.matchCount > 0 || root.query.length > 0
            onTextEdited: root.query = NotificationLogic.plainField(text, NotificationLogic.maxQuery())
            Keys.priority: Keys.BeforeItem
            Keys.onPressed: function(event) {
              if (event.key !== Qt.Key_Escape) return
              if (!root.opened || root.sheetBusy) return
              if (root.query.length > 0) root.clearSearch()
              else root.close()
              event.accepted = true
            }
          }

          ListView {
            id: listView
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            spacing: Style.space(8)
            model: root.filteredDisplay
            visible: root.matchCount > 0
            boundsBehavior: Flickable.StopAtBounds

            delegate: Item {
              id: wrap
              required property var modelData
              width: listView.width
              height: wrap.modelData && wrap.modelData.type === "header"
                ? headerLabel.implicitHeight + Style.space(4)
                : card.implicitHeight

              Text {
                id: headerLabel
                visible: wrap.modelData && wrap.modelData.type === "header"
                text: wrap.modelData && wrap.modelData.label ? wrap.modelData.label : ""
                textFormat: Text.PlainText
                color: root.colDim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
              }

              BorderSurface {
                id: card
                visible: wrap.modelData && wrap.modelData.type !== "header"
                width: parent.width
                implicitHeight: visible ? rowContent.implicitHeight + Style.space(16) : 0
                radius: root.cardRadius
                color: cardHover.containsMouse
                  ? Style.hoverFillFor(root.colForeground, root.colAccent)
                  : Style.normalFillFor(root.colForeground, root.colAccent)
                borderSpec: Border.flat(Util.alpha(root.colForeground, cardHover.containsMouse ? 0.22 : 0.12), 1)

                readonly property var row: wrap.modelData
                readonly property string smallIcon: root.iconSource(card.row && (card.row.image || card.row.appIcon))
                readonly property bool hasIcon: !!(card.row && !card.row.glyph && card.smallIcon)
                readonly property string bodyText: card.row
                  ? NotificationLogic.sanitizeBody(card.row.body, card.row.app, card.row.appIcon) : ""

                MouseArea {
                  id: cardHover
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.activateRow(card.row)
                }

                RowLayout {
                  id: rowContent
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(12)
                  anchors.rightMargin: Style.space(10)
                  spacing: Style.space(10)

                  Text {
                    visible: !!(card.row && card.row.glyph)
                    text: card.row && card.row.glyph ? card.row.glyph : ""
                    textFormat: Text.PlainText
                    color: card.row && card.row.urgency === 2 ? root.colUrgent : root.colAccent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.icon
                    Layout.alignment: Qt.AlignTop
                  }

                  Item {
                    visible: card.hasIcon
                    Layout.preferredWidth: Style.space(28)
                    Layout.preferredHeight: Style.space(28)
                    Layout.alignment: Qt.AlignVCenter
                    Image {
                      anchors.fill: parent
                      source: card.smallIcon
                      fillMode: Image.PreserveAspectFit
                      asynchronous: true
                      smooth: true
                      sourceSize.width: Style.space(28)
                      sourceSize.height: Style.space(28)
                    }
                  }

                  ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Style.space(2)

                    RowLayout {
                      Layout.fillWidth: true
                      Text {
                        Layout.fillWidth: true
                        text: card.row && card.row.app ? card.row.app : ""
                        textFormat: Text.PlainText
                        color: root.colDim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }
                      Text {
                        text: card.row ? NotificationLogic.formatTimestamp(card.row.timestamp, Date.now()) : ""
                        textFormat: Text.PlainText
                        color: root.colDim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }

                    Text {
                      Layout.fillWidth: true
                      visible: !!(card.row && card.row.summary)
                      text: card.row && card.row.summary ? card.row.summary : ""
                      textFormat: Text.PlainText
                      color: root.colForeground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.subtitle
                      font.bold: true
                      wrapMode: Text.WordWrap
                      elide: Text.ElideRight
                      maximumLineCount: 2
                    }

                    Text {
                      Layout.fillWidth: true
                      visible: card.bodyText.length > 0
                      text: card.bodyText
                      textFormat: Text.PlainText
                      color: root.colDim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                      wrapMode: Text.WordWrap
                      elide: Text.ElideRight
                      maximumLineCount: 3
                    }
                  }

                  Rectangle {
                    Layout.preferredWidth: Style.space(20)
                    Layout.preferredHeight: Style.space(20)
                    Layout.alignment: Qt.AlignVCenter
                    visible: cardHover.containsMouse
                    radius: Math.min(4, root.cardRadius)
                    color: dismissHover.containsMouse ? Util.alpha(root.colForeground, 0.16) : "transparent"

                    Text {
                      anchors.centerIn: parent
                      text: "✕"
                      textFormat: Text.PlainText
                      color: root.colDim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }

                    MouseArea {
                      id: dismissHover
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onClicked: function(mouse) {
                        mouse.accepted = true
                        root.dismissRow(card.row)
                      }
                    }
                  }
                }
              }
            }
          }

          Item {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: root.matchCount === 0

            Column {
              anchors.centerIn: parent
              spacing: Style.space(8)

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "󰂚"
                textFormat: Text.PlainText
                color: Util.alpha(root.colForeground, 0.22)
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge
              }

              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.query.trim() === "" ? "You're all caught up" : "No matching notifications"
                textFormat: Text.PlainText
                color: root.colDim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }

              Text {
                visible: root.query.trim() === ""
                anchors.horizontalCenter: parent.horizontalCenter
                width: Style.space(240)
                wrapMode: Text.WordWrap
                horizontalAlignment: Text.AlignHCenter
                text: "Drag in from the right edge of the screen"
                textFormat: Text.PlainText
                color: Util.alpha(root.colForeground, 0.45)
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }
            }
          }
        }

        Item {
          id: keyCatcher
          anchors.fill: parent
          focus: root.fullyOpen
          enabled: root.fullyOpen && !root.sheetBusy
          Keys.priority: Keys.AfterItem
          Keys.onPressed: function(event) {
            if (event.key !== Qt.Key_Escape) return
            if (!root.opened || root.sheetBusy) return
            root.close()
            event.accepted = true
          }
        }
      }
    }
  }
}
