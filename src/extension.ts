import * as vscode from "vscode";
import { readConfig, scanDocument, scanWorkspace, matchesScope, CONFIG_SECTION, isLikelyBinaryFile } from "./scanner";

export function activate(context: vscode.ExtensionContext)
{
    const diagnosticCollection = vscode.languages.createDiagnosticCollection(CONFIG_SECTION);
    context.subscriptions.push(diagnosticCollection);

    let config = readConfig();
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

    // Debounced per-file rescan while typing
    const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const CHANGE_DEBOUNCE_MS = 300;
    function debouncedDocumentRescan(document: vscode.TextDocument): void
    {
        const key = document.uri.toString();
        const existing = changeTimers.get(key);
        if (existing !== undefined)
        {
            clearTimeout(existing);
        }
        changeTimers.set(key, setTimeout(() =>
        {
            changeTimers.delete(key);
            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        }, CHANGE_DEBOUNCE_MS));
    }

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

            // Cancel any pending debounced rescan — save is authoritative
            const pending = changeTimers.get(key);
            if (pending !== undefined)
            {
                clearTimeout(pending);
                changeTimers.delete(key);
            }

            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        })
    );

    // Re-scan a file as the user types
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) =>
        {
            if (e.document.uri.scheme !== "file" || e.contentChanges.length === 0)
            {
                return;
            }
            debouncedDocumentRescan(e.document);
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
            if (await isLikelyBinaryFile(uri))
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
            if (await isLikelyBinaryFile(uri))
            {
                diagnosticCollection.delete(uri);
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
                config = readConfig();
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
            for (const timer of changeTimers.values())
            {
                clearTimeout(timer);
            }
            changeTimers.clear();
        }
    });
}

export function deactivate() { }
