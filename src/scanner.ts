import * as vscode from "vscode";

export const CONFIG_SECTION = "displayTodos";

export interface KeywordConfig
{
    keyword: string;
    severity: "error" | "warning" | "info" | "hint";
}

export interface ScanConfig
{
    keywords: KeywordConfig[];
    include: string[];
    exclude: string[];
    pattern: string;
    caseSensitive: boolean;
    displayName: string;
}

const SEVERITY_MAP: Record<string, vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint
};

/**
 * Build a lookup from keyword to its configured severity.
 * Keys are stored uppercase when case-insensitive, or as-is when case-sensitive.
 */
function buildSeverityLookup(
    keywords: KeywordConfig[],
    caseSensitive: boolean
): Map<string, vscode.DiagnosticSeverity>
{
    const map = new Map<string, vscode.DiagnosticSeverity>();
    for (const kw of keywords)
    {
        const key = caseSensitive ? kw.keyword : kw.keyword.toUpperCase();
        map.set(
            key,
            SEVERITY_MAP[kw.severity] ?? vscode.DiagnosticSeverity.Warning
        );
    }
    return map;
}

/**
 * Build a regex that matches any of the configured keywords.
 * Uses the user-configured pattern, replacing `{keywords}` with the joined keyword alternatives.
 * The pattern must contain two capture groups: group 1 = keyword, group 2 = trailing text.
 */
function buildPattern(keywords: KeywordConfig[], pattern: string, caseSensitive: boolean): RegExp
{
    const escaped = keywords.map((kw) =>
        kw.keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const flags = caseSensitive ? "" : "i";
    const source = pattern.replace("{keywords}", escaped.join("|"));
    return new RegExp(source, flags);
}

/**
 * Check whether scanning is enabled for a given document,
 * respecting language-specific overrides.
 */
export function isEnabledFor(document: vscode.TextDocument): boolean
{
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION, document);
    return cfg.get<boolean>("enable", true);
}

/**
 * Scan a single document for TODO-style comments and return diagnostics.
 */
export function scanDocument(
    document: vscode.TextDocument,
    config: ScanConfig
): vscode.Diagnostic[]
{
    if (!isEnabledFor(document) || config.keywords.length === 0)
    {
        return [];
    }

    const pattern = buildPattern(config.keywords, config.pattern, config.caseSensitive);
    const severityLookup = buildSeverityLookup(config.keywords, config.caseSensitive);
    const diagnostics: vscode.Diagnostic[] = [];

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++)
    {
        const line = document.lineAt(lineIndex);
        const match = pattern.exec(line.text);
        if (!match || match.index === undefined)
        {
            continue;
        }

        const keyword = config.caseSensitive ? match[1] : match[1].toUpperCase();
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
        diagnostic.source = config.displayName;
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

/**
 * Read the extension configuration from VS Code settings.
 */
export function readConfig(displayName: string): ScanConfig
{
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
        keywords: cfg.get<KeywordConfig[]>("keywords", []),
        include: cfg.get<string[]>("include", []),
        exclude: cfg.get<string[]>("exclude", []),
        pattern: cfg.get<string>("pattern", ""),
        caseSensitive: cfg.get<boolean>("caseSensitive", true),
        displayName
    };
}

/**
 * Convert an array of glob patterns into a single brace-expanded glob
 * suitable for `workspace.findFiles`.
 */
export function toGlob(patterns: string[]): string
{
    const filtered = patterns.map((p) => p.trim()).filter(Boolean);
    if (filtered.length === 0)
    {
        return "";
    }
    if (filtered.length === 1)
    {
        return filtered[0];
    }
    return `{${filtered.join(",")}}`;
}

/**
 * Scan every matching file in the workspace and populate the DiagnosticCollection.
 */
export async function scanWorkspace(
    diagnosticCollection: vscode.DiagnosticCollection,
    config: ScanConfig,
    inScopeUris: Set<string>
): Promise<void>
{
    diagnosticCollection.clear();
    inScopeUris.clear();

    const globalEnable = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>("enable", true);
    if (!globalEnable)
    {
        return;
    }

    const uris = await getFileUris(config);

    for (const uri of uris)
    {
        inScopeUris.add(uri.toString());
        try
        {
            const document = await vscode.workspace.openTextDocument(uri);
            const diagnostics = scanDocument(document, config);
            if (diagnostics.length > 0)
            {
                diagnosticCollection.set(uri, diagnostics);
            }
        } catch
        {
            // Skip files that can't be opened (binary, too large, etc.)
        }
    }
}

export async function getFileUris(config: ScanConfig)
{
    const includeGlob = toGlob(config.include);
    const excludeGlob = toGlob(config.exclude);
    const uris = await vscode.workspace.findFiles(includeGlob, excludeGlob);
    return uris;
}
