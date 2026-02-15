## Overview

This extension will scan your workspace and opened files for **FIXME**, **BUG**, **TODO**, **HACK**, **XXX**, **NOTE**, **REVIEW**
comments, and displays them in the ****PROBLEMS**** panel.

![Example](media/example.png)

## Features

- You can define your own keywords.
- You can change the regex pattern used for matching the keywords.
- You can exclude directories from scanning.
- You can disable it per file type level.

## Default Keywords & Severities

| Keyword | Severity |
|-|-|
| FIXME | Error |
| BUG | Error |
| TODO | Warning |
| HACK | Warning |
| XXX | Warning |
| NOTE | Info |
| REVIEW | Hint |

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `displayTodos.keywords` | `array` | See above | List of keywords to scan for and their diagnostic severities. |
| `displayTodos.include` | `string[]` | `["**/*"]` | Glob patterns for files to include when scanning. |
| `displayTodos.exclude` | `string[]` | `["**/.git/**", "**/.vscode/**", "**/node_modules/**", "**/build/**", "**/dist/**", "**/out/**"]` | Glob patterns for files to exclude when scanning. |
| `displayTodos.pattern` | `string` | `^\\s*(?:(?:\\/\\/\|#)\\s*)?\\b({keywords})(?=[:\\s]\|$)(?:\\s*:\\s*\|\\s+)?(.*)$` | Regex pattern used to match keywords. Use {keywords} as a placeholder for the joined keyword alternatives. Must contain two capture groups: group 1 for the matched keyword and group 2 for the trailing text. |
| `displayTodos.caseSensitive` | `boolean` | `true` | Whether keyword matching is case-sensitive. When true, only exact case matches (e.g. TODO, not todo) are detected. |
| `displayTodos.enable` | `boolean` | `true` | Enable or disable scanning for TODO comments. When false, all diagnostics are cleared and no scanning occurs. Can be overridden per language (e.g. \"[python]\": { \"displayTodos.enable\": false }). |
