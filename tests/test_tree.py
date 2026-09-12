#!/usr/bin/env python3
"""Reject agent-instruction files and pin the surfaces issue 5601 asked
the next review to verify: PlainText rendering, confined process argv,
parameterless IPC, and bounded gesture output."""

from __future__ import annotations

import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

AGENT_BASENAMES = {
    "agents.md",
    "claude.md",
    "claude.local.md",
    "gemini.md",
    ".cursorrules",
    ".windsurfrules",
    "copilot-instructions.md",
    ".mcp.json",
}

AGENT_DIR_PREFIXES = (
    ".agents/",
    ".claude/",
    ".codex/",
    ".gemini/",
    ".cursor/",
)


def git_names(*args: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", ROOT, "ls-files", *args],
        capture_output=True,
        text=True,
        check=True,
    )
    return [name for name in out.stdout.split("\n") if name]


def tracked() -> list[str]:
    return git_names("--cached")


def published_or_pending() -> list[str]:
    return git_names("--cached", "--others", "--exclude-standard")


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as handle:
        return handle.read()


def qml_blocks(text: str, opener: str):
    for match in re.finditer(r"(?<![\w.])" + opener + r"\s*\{", text):
        depth = 0
        i = match.end() - 1
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    yield text[match.start() : i + 1]
                    break
            i += 1


class PublishedTree(unittest.TestCase):
    def test_no_agent_instruction_file_is_tracked(self):
        names = tracked()
        bad = [
            name
            for name in names
            if os.path.basename(name).lower() in AGENT_BASENAMES
            or name.startswith(AGENT_DIR_PREFIXES)
        ]
        self.assertEqual(bad, [])

    def test_required_runtime_files_are_tracked(self):
        names = set(published_or_pending())
        for must in (
            "manifest.json",
            "README.md",
            "LICENSE",
            "DEVELOPMENT.md",
            "Overlay.qml",
            "NotificationLogic.js",
            "gesture.py",
            "tests/test_logic.js",
            "tests/test_gesture.py",
            "tests/test_tree.py",
        ):
            self.assertIn(must, names)


class RichTextHandling(unittest.TestCase):
    def test_every_text_block_is_plain(self):
        qml = read("Overlay.qml")
        found = 0
        for block in qml_blocks(qml, "Text"):
            found += 1
            self.assertIn(
                "textFormat: Text.PlainText",
                block,
                f"Text without PlainText:\n{block[:240]}",
            )
        self.assertGreater(found, 8)

    def test_no_rich_or_styled_sink(self):
        qml = read("Overlay.qml")
        for token in ("RichText", "StyledText", "AutoText", "MarkdownText"):
            self.assertNotIn(token, qml, token)


class ProcessAndIpc(unittest.TestCase):
    def test_ipc_is_parameterless_and_does_not_shadow_shell_contract(self):
        qml = read("Overlay.qml")
        blocks = list(qml_blocks(qml, "IpcHandler"))
        self.assertEqual(len(blocks), 1)
        block = blocks[0]
        self.assertIn('target: "notification-slideover"', block)
        self.assertRegex(block, r"function state\(\)\s*:\s*string")
        self.assertRegex(block, r"function ping\(\)\s*:\s*string")
        self.assertNotRegex(block, r"function (open|close|toggle)\s*\(")

    def test_overlay_does_not_build_shell_argv_inline(self):
        qml = read("Overlay.qml")
        self.assertNotIn('["bash"', qml)
        self.assertNotIn('["/usr/bin/bash"', qml)
        self.assertNotIn("rm -f", qml)
        self.assertIn("NotificationLogic.historyDeleteArgs", qml)
        self.assertIn("NotificationLogic.historyReadArgs", qml)
        self.assertIn("NotificationLogic.focusAppArgs", qml)
        self.assertIn("NotificationLogic.gestureCommand", qml)
        self.assertIn("NotificationLogic.reservedMonitorsArgs", qml)

    def test_logic_delete_args_are_positional_and_confined(self):
        js = read("NotificationLogic.js")
        self.assertIn('rm -f -- \\"$1/$2.json\\"', js)
        self.assertNotIn("$2-*", js)
        self.assertIn('leaf !== "history" && leaf !== "images"', js)


class GestureBounds(unittest.TestCase):
    def test_overlay_uses_chunked_parser_not_unbounded_lines(self):
        qml = read("Overlay.qml")
        self.assertIn("splitMarker: \"\"", qml)
        self.assertIn("handleGestureChunk", qml)
        self.assertIn("consumeGestureChunk", qml)

    def test_python_emitter_caps_line_length(self):
        py = read("gesture.py")
        self.assertIn("MAX_JSON_LINE = 256", py)
        self.assertIn("if len(line) > MAX_JSON_LINE:", py)


if __name__ == "__main__":
    unittest.main()
