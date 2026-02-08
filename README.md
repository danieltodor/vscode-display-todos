## Overview

This extension will scan your workspace and opened files for **FIXME**, **BUG**, **TODO**, **HACK**, **XXX**, **NOTE**, **REVIEW**
comments, and displays them in the `problems` panel.

![Example](media/example.png)

## Features

- **Full workspace scan on startup** — automatically scans every file in the workspace, and reports all matches in the problems panel.
- **Re-scan on save** — when you save a file, it is immediately re-scanned and its diagnostics are updated.
- **Re-scan on open** — when you open a file in the editor, it is re-scanned so new changes are picked up right away.
- **Configurable keywords & severity** — define your own keywords and assign each one a diagnostic severity (`error`, `warning`, `info`, `hint`).
- **Case-sensitive by default** — only exact-case matches are detected (e.g. `TODO` but not `todo`). Can be toggled to case-insensitive via settings.
- **Include / exclude glob patterns** — control which files are scanned using glob patterns.

## Default Keywords & Severities

| Keyword | Severity |
|-|-|
| FIXME | Error |
| BUG | Error |
| TODO | Warning |
| HACK | Warning |
| XXX | Warning |
| NOTE | info |
| REVIEW | hint |

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `displayTodos.keywords` | `array` | See above | List of keywords to scan for and their diagnostic severities. |
| `displayTodos.include` | `string[]` | `["**/*"]` | Glob patterns for files to include when scanning. |
| `displayTodos.exclude` | `string[]` | `["**/.git/**", "**/.vscode/**", "**/node_modules/**", "**/build/**", "**/dist/**", "**/out/**"]` | Glob patterns for files to exclude when scanning. |
| `displayTodos.pattern` | `string` | `\\b({keywords})\\b[:\\s]+(.+)` | Regex pattern used to match keywords. Use {keywords} as a placeholder for the joined keyword alternatives. Must contain two capture groups: group 1 for the matched keyword and group 2 for the trailing text. |
| `displayTodos.caseSensitive` | `boolean` | `true` | Whether keyword matching is case-sensitive. When true, only exact case matches (e.g. TODO, not todo) are detected. |
| `displayTodos.enable` | `boolean` | `true` | Enable or disable scanning for TODO comments. When false, all diagnostics are cleared and no scanning occurs. Can be overridden per language (e.g. \"[python]\": { \"displayTodos.enable\": false }). |
