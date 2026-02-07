import * as vscode from "vscode";
import { readConfig, scanDocument, scanWorkspace } from "./scanner";

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
