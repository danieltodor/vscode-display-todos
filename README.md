# Search TODOs

A VS Code extension that scans your workspace for **TODO**, **FIXME**, **HACK**, **BUG**, and **XXX** comments and displays them as diagnostics in the **Problems** panel.

## Features

- **Automatic workspace scan** — scans all files on startup and reports matches in the Problems panel.
- **Re-scan on save** — when you save a file, it is re-scanned immediately.
- **Configurable keywords & severity** — add your own keywords or change severities (error, warning, info, hint).
- **Case-sensitive by default** — matches exact case (`TODO` but not `todo`). Can be toggled to case-insensitive.
- **Include / exclude globs** — control which files are scanned.

## Default Severities

| Keyword | Severity |
|---------|----------|
| FIXME   | Error    |
| BUG     | Error    |
| TODO    | Warning  |
| HACK    | Warning  |
| XXX     | Warning  |

## Extension Settings

This extension contributes the following settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `searchTodos.keywords` | Array of `{ keyword, severity }` objects | See above |
| `searchTodos.include` | Glob patterns for files to include | `["**/*"]` |
| `searchTodos.exclude` | Glob patterns for files to exclude | `["**/.git/**", "**/.vscode/**", "**/node_modules/**", "**/build/**", "**/dist/**", "**/out/**"]` |
| `searchTodos.caseSensitive` | Whether keyword matching is case-sensitive | `true` |

### Example: Add a custom keyword

```jsonc
// settings.json
{
  "searchTodos.keywords": [
    { "keyword": "FIXME", "severity": "error" },
    { "keyword": "BUG", "severity": "error" },
    { "keyword": "TODO", "severity": "warning" },
    { "keyword": "HACK", "severity": "warning" },
    { "keyword": "XXX", "severity": "warning" },
    { "keyword": "NOTE", "severity": "info" }
  ]
}
```
