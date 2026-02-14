import * as vscode from "vscode";
import { readConfig, scanDocument, scanWorkspace, matchesScope, CONFIG_SECTION } from "./scanner";

export function activate(context: vscode.ExtensionContext)
{
    const displayName: string = context.extension.packageJSON.displayName;

    const diagnosticCollection = vscode.languages.createDiagnosticCollection(CONFIG_SECTION);
    context.subscriptions.push(diagnosticCollection);

    let config = readConfig(displayName);
    const inScopeUris = new Set<string>();
    const recentlySavedUris = new Set<string>();

    // Cancellable workspace scan
    let scanCts: vscode.CancellationTokenSource | undefined;
    function startScan(): void
    {
        scanCts?.cancel();
        scanCts?.dispose();
        scanCts = new vscode.CancellationTokenSource();
        const token = scanCts.token;
        scanWorkspace(diagnosticCollection, config, inScopeUris, token);
    }

    // Debounced rescan for config changes
    let rescanTimer: ReturnType<typeof setTimeout> | undefined;
    const RESCAN_DEBOUNCE_MS = 400;
    function debouncedRescan(): void
    {
        if (rescanTimer !== undefined)
        {
            clearTimeout(rescanTimer);
        }
        rescanTimer = setTimeout(() =>
        {
            rescanTimer = undefined;
            startScan();
        }, RESCAN_DEBOUNCE_MS);
    }

    // Initial full workspace scan
    startScan();

    // Re-scan a single file on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) =>
        {
            if (document.uri.scheme !== "file")
            {
                return;
            }

            const key = document.uri.toString();
            recentlySavedUris.add(key);
            setTimeout(() => recentlySavedUris.delete(key), 1000);

            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        })
    );

    // Re-scan a file when it is opened in the editor
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) =>
        {
            if (document.uri.scheme !== "file")
            {
                return;
            }

            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        })
    );

    // Clear diagnostics when a file is closed, only if it's outside the include/exclude scope
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) =>
        {
            if (document.uri.scheme !== "file")
            {
                return;
            }

            if (!inScopeUris.has(document.uri.toString()))
            {
                diagnosticCollection.delete(document.uri);
            }
        })
    );

    // Handle file creates, deletes, and renames
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");

    watcher.onDidDelete((uri) =>
    {
        const key = uri.toString();

        // Direct file match
        if (inScopeUris.has(key))
        {
            diagnosticCollection.delete(uri);
            inScopeUris.delete(key);
            return;
        }

        // URI may be a directory — remove all tracked files under it
        const prefix = key.endsWith("/") ? key : key + "/";
        for (const scopeUri of inScopeUris)
        {
            if (scopeUri.startsWith(prefix))
            {
                diagnosticCollection.delete(vscode.Uri.parse(scopeUri));
                inScopeUris.delete(scopeUri);
            }
        }
    });

    watcher.onDidCreate(async (uri) =>
    {
        try
        {
            if (!matchesScope(uri, config))
            {
                return;
            }
            const document = await vscode.workspace.openTextDocument(uri);
            inScopeUris.add(uri.toString());
            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(uri, diagnostics);
        } catch
        {
            // Skip files that can't be opened (binary, etc.)
        }
    });

    watcher.onDidChange(async (uri) =>
    {
        try
        {
            const key = uri.toString();
            if (recentlySavedUris.has(key) || !inScopeUris.has(key))
            {
                return;
            }
            const document = await vscode.workspace.openTextDocument(uri);
            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(uri, diagnostics);
        } catch
        {
            // Skip files that can't be opened (binary, etc.)
        }
    });

    context.subscriptions.push(watcher);

    // Re-scan the whole workspace when configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) =>
        {
            if (e.affectsConfiguration(CONFIG_SECTION))
            {
                config = readConfig(displayName);
                debouncedRescan();
            }
        })
    );

    // Clean up on deactivation
    context.subscriptions.push({
        dispose()
        {
            scanCts?.cancel();
            scanCts?.dispose();
            if (rescanTimer !== undefined)
            {
                clearTimeout(rescanTimer);
            }
        }
    });
}

export function deactivate() { }
