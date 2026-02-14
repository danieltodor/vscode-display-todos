import * as vscode from "vscode";

export const CONFIG_SECTION = "displayTodos";

/** Concurrency limit for parallel file reads during workspace scan. */
const BATCH_SIZE = 50;

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

/**
 * Pre-compiled artefacts derived from a ScanConfig.
 * Build once via `compileConfig` and reuse across many files.
 */
export interface CompiledConfig
{
    pattern: RegExp;
    severityLookup: Map<string, vscode.DiagnosticSeverity>;
    caseSensitive: boolean;
    displayName: string;
}

/**
 * Compile the expensive parts of a ScanConfig (regex, severity map)
 * so they can be reused across an entire workspace scan.
 */
export function compileConfig(config: ScanConfig): CompiledConfig
{
    if (config.keywords.length === 0)
    {
        return {
            pattern: /(?!)/,  // never-matching regex
            severityLookup: new Map(),
            caseSensitive: config.caseSensitive,
            displayName: config.displayName
        };
    }
    return {
        pattern: buildPattern(config.keywords, config.pattern, config.caseSensitive),
        severityLookup: buildSeverityLookup(config.keywords, config.caseSensitive),
        caseSensitive: config.caseSensitive,
        displayName: config.displayName
    };
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
function buildSeverityLookup(keywords: KeywordConfig[], caseSensitive: boolean): Map<string, vscode.DiagnosticSeverity>
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
 * Accepts either a raw ScanConfig (convenience, compiles internally)
 * or a pre-compiled CompiledConfig for bulk scanning.
 */
export function scanDocument(document: vscode.TextDocument, config: ScanConfig | CompiledConfig): vscode.Diagnostic[]
{
    if (!isEnabledFor(document))
    {
        return [];
    }

    const compiled = isCompiledConfig(config) ? config : compileConfig(config);
    return scanLines(compiled, (i) => document.lineAt(i).text, document.lineCount);
}

/**
 * Scan raw text content (string) for TODO-style comments.
 * Used during workspace scans to avoid the overhead of `openTextDocument`.
 */
export function scanText(text: string, compiled: CompiledConfig): vscode.Diagnostic[]
{
    const lines = text.split(/\r?\n/);
    return scanLines(compiled, (i) => lines[i], lines.length);
}

/**
 * Shared scanning core — iterate lines by index and collect diagnostics.
 */
function scanLines(
    compiled: CompiledConfig,
    lineAt: (index: number) => string,
    lineCount: number
): vscode.Diagnostic[]
{
    const { pattern, severityLookup, caseSensitive, displayName } = compiled;
    const diagnostics: vscode.Diagnostic[] = [];

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex++)
    {
        const lineText = lineAt(lineIndex);
        const match = pattern.exec(lineText);
        if (!match || match.index === undefined)
        {
            continue;
        }

        const keyword = caseSensitive ? match[1] : match[1].toUpperCase();
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
        diagnostic.source = displayName;
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

function isCompiledConfig(config: ScanConfig | CompiledConfig): config is CompiledConfig
{
    return "pattern" in config && config.pattern instanceof RegExp;
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
 * Supports cancellation via the optional CancellationToken.
 */
export async function scanWorkspace(
    diagnosticCollection: vscode.DiagnosticCollection,
    config: ScanConfig,
    inScopeUris: Set<string>,
    token?: vscode.CancellationToken
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

    const compiled = compileConfig(config);
    const decoder = new TextDecoder("utf-8");
    const uris = await getFileUris(config);

    if (token?.isCancellationRequested) { return; }

    // Build the set of already-open document URIs so we can prefer the
    // in-memory version (which may have unsaved edits).
    const openDocsByUri = new Map<string, vscode.TextDocument>();
    for (const doc of vscode.workspace.textDocuments)
    {
        openDocsByUri.set(doc.uri.toString(), doc);
    }

    // Process files in parallel batches
    for (let i = 0; i < uris.length; i += BATCH_SIZE)
    {
        if (token?.isCancellationRequested) { return; }

        const batch = uris.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async (uri) =>
            {
                const key = uri.toString();
                inScopeUris.add(key);

                // Prefer already-open document (has unsaved edits, already in memory)
                const openDoc = openDocsByUri.get(key);
                if (openDoc)
                {
                    return { uri, diagnostics: scanDocument(openDoc, compiled) };
                }

                // Read raw bytes — much cheaper than openTextDocument
                const bytes = await vscode.workspace.fs.readFile(uri);
                const text = decoder.decode(bytes);
                return { uri, diagnostics: scanText(text, compiled) };
            })
        );

        for (const result of results)
        {
            if (result.status === "fulfilled")
            {
                const { uri, diagnostics } = result.value;
                if (diagnostics.length > 0)
                {
                    diagnosticCollection.set(uri, diagnostics);
                }
            }
            // rejected = binary / unreadable file — skip silently
        }
    }

    if (token?.isCancellationRequested) { return; }

    // Scan opened editors that weren't covered by the file-glob scan
    for (const document of vscode.workspace.textDocuments)
    {
        if (!inScopeUris.has(document.uri.toString()))
        {
            const diagnostics = scanDocument(document, compiled);
            diagnosticCollection.set(document.uri, diagnostics);
        }
    }
}

export async function getFileUris(config: ScanConfig)
{
    const includeGlob = toGlob(config.include);
    const excludeGlob = toGlob(config.exclude);
    return await vscode.workspace.findFiles(includeGlob, excludeGlob);
}

/**
 * Test whether a URI matches the include/exclude globs.
 * Pure glob matching — no filesystem queries needed.
 */
export function matchesScope(uri: vscode.Uri, config: ScanConfig): boolean
{
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder)
    {
        return false;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false);

    // Must match at least one include pattern
    const included = config.include.some((pattern) =>
        matchGlob(relativePath, pattern.trim())
    );
    if (!included)
    {
        return false;
    }

    // Must not match any exclude pattern
    const excluded = config.exclude.some((pattern) =>
        matchGlob(relativePath, pattern.trim())
    );
    return !excluded;
}

/**
 * Simple glob matcher for exclude patterns.
 * Handles common patterns like ** /foo/**, *.ext, etc.
 */
function matchGlob(path: string, pattern: string): boolean
{
    // Convert glob to regex
    const regexSource = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\0")
        .replace(/\*/g, "[^/]*")
        .replace(/\0/g, ".*")
        .replace(/\?/g, "[^/]");
    return new RegExp(`^${regexSource}$`).test(path);
}
