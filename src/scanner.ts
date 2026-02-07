import * as vscode from "vscode";

export interface KeywordConfig {
  keyword: string;
  severity: "error" | "warning" | "info" | "hint";
}

export interface ScanConfig {
  keywords: KeywordConfig[];
  include: string;
  exclude: string;
}

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/**
 * Build a lookup from uppercase keyword to its configured severity.
 */
function buildSeverityLookup(
  keywords: KeywordConfig[]
): Map<string, vscode.DiagnosticSeverity> {
  const map = new Map<string, vscode.DiagnosticSeverity>();
  for (const kw of keywords) {
    map.set(
      kw.keyword.toUpperCase(),
      SEVERITY_MAP[kw.severity] ?? vscode.DiagnosticSeverity.Warning
    );
  }
  return map;
}

/**
 * Build a regex that matches any of the configured keywords.
 * Captures: group 1 = keyword, group 2 = optional trailing text after `:` or whitespace.
 */
function buildPattern(keywords: KeywordConfig[]): RegExp {
  const escaped = keywords.map((kw) =>
    kw.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  // Match keyword at a word boundary, optionally followed by : and/or whitespace, then trailing text
  return new RegExp(`\\b(${escaped.join("|")})\\b[:\\s]?(.*)`, "i");
}

/**
 * Scan a single document for TODO-style comments and return diagnostics.
 */
export function scanDocument(
  document: vscode.TextDocument,
  config: ScanConfig
): vscode.Diagnostic[] {
  if (config.keywords.length === 0) {
    return [];
  }

  const pattern = buildPattern(config.keywords);
  const severityLookup = buildSeverityLookup(config.keywords);
  const diagnostics: vscode.Diagnostic[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const line = document.lineAt(lineIndex);
    const match = pattern.exec(line.text);
    if (!match || match.index === undefined) {
      continue;
    }

    const keyword = match[1].toUpperCase();
    const trailing = match[2]?.trim() ?? "";
    const message = trailing ? `${keyword}: ${trailing}` : keyword;

    const startPos = new vscode.Position(lineIndex, match.index);
    const endPos = new vscode.Position(
      lineIndex,
      match.index + match[0].trimEnd().length
    );
    const range = new vscode.Range(startPos, endPos);

    const severity =
      severityLookup.get(keyword) ?? vscode.DiagnosticSeverity.Warning;

    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "Search TODOs";
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

/**
 * Read the extension configuration from VS Code settings.
 */
export function readConfig(): ScanConfig {
  const cfg = vscode.workspace.getConfiguration("searchTodos");
  return {
    keywords: cfg.get<KeywordConfig[]>("keywords", [
      { keyword: "FIXME", severity: "error" },
      { keyword: "BUG", severity: "error" },
      { keyword: "TODO", severity: "warning" },
      { keyword: "HACK", severity: "warning" },
      { keyword: "XXX", severity: "warning" },
    ]),
    include: cfg.get<string>("include", "**/*"),
    exclude: cfg.get<string>("exclude", "**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/.vscode/**"),
  };
}

/**
 * Build the exclude pattern for `workspace.findFiles`.
 * Combines the user-configured exclude with the workspace `files.exclude` setting.
 * `workspace.findFiles` accepts a single glob string or a RelativePattern —
 * we convert the comma-separated list into a brace-expanded glob: `{a,b,c}`.
 */
function buildExcludeGlob(exclude: string): string {
  const parts = exclude
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    return parts[0];
  }
  return `{${parts.join(",")}}`;
}

/**
 * Scan every matching file in the workspace and populate the DiagnosticCollection.
 */
export async function scanWorkspace(
  diagnosticCollection: vscode.DiagnosticCollection,
  config: ScanConfig
): Promise<void> {
  diagnosticCollection.clear();

  const excludeGlob = buildExcludeGlob(config.exclude);
  const uris = await vscode.workspace.findFiles(config.include, excludeGlob);

  for (const uri of uris) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const diagnostics = scanDocument(document, config);
      if (diagnostics.length > 0) {
        diagnosticCollection.set(uri, diagnostics);
      }
    } catch {
      // Skip files that can't be opened (binary, too large, etc.)
    }
  }
}
