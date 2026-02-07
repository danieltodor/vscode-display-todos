import * as vscode from "vscode";
import { readConfig, scanDocument, scanWorkspace, toGlob, ScanConfig, getFileUris } from "./scanner";

export function activate(context: vscode.ExtensionContext)
{
    const displayName: string =
        context.extension.packageJSON.displayName;

    const diagnosticCollection =
        vscode.languages.createDiagnosticCollection("searchTodos");
    context.subscriptions.push(diagnosticCollection);

    let config = readConfig(displayName);
    const inScopeUris = new Set<string>();

    // Initial full workspace scan
    scanWorkspace(diagnosticCollection, config, inScopeUris);

    // Re-scan a single file on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) =>
        {
            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        })
    );

    // Re-scan a file when it is opened in the editor
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) =>
        {
            const diagnostics = scanDocument(document, config);
            diagnosticCollection.set(document.uri, diagnostics);
        })
    );

    // Clear diagnostics when a file is closed, only if it's outside the include/exclude scope
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) =>
        {
            if (!inScopeUris.has(document.uri.toString()))
            {
                diagnosticCollection.delete(document.uri);
            }
        })
    );

    /**
     * Check whether a URI is within the configured include/exclude scope
     */
    async function isInScope(uri: vscode.Uri, cfg: ScanConfig): Promise<boolean>
    {
        const uris = await getFileUris(cfg);
        return uris.some((u) => u.toString() === uri.toString());
    }

    // Handle file creates, deletes, and renames
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");

    watcher.onDidDelete((uri) =>
    {
        diagnosticCollection.delete(uri);
        inScopeUris.delete(uri.toString());
    });

    watcher.onDidCreate(async (uri) =>
    {
        try
        {
            if (!await isInScope(uri, config))
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

    context.subscriptions.push(watcher);

    // Re-scan the whole workspace when configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) =>
        {
            if (e.affectsConfiguration("searchTodos"))
            {
                config = readConfig(displayName);
                scanWorkspace(diagnosticCollection, config, inScopeUris);
            }
        })
    );
}

export function deactivate() { }
