import * as vscode from "vscode";
import { readConfig, scanDocument, scanWorkspace } from "./scanner";

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("searchTodos");
  context.subscriptions.push(diagnosticCollection);

  let config = readConfig();

  // Initial full workspace scan
  scanWorkspace(diagnosticCollection, config);

  // Re-scan a single file on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      const diagnostics = scanDocument(document, config);
      diagnosticCollection.set(document.uri, diagnostics);
    })
  );

  // Clear diagnostics when a file is closed (keeps Problems panel tidy)
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      diagnosticCollection.delete(document.uri);
    })
  );

  // Re-scan the whole workspace when configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("searchTodos")) {
        config = readConfig();
        scanWorkspace(diagnosticCollection, config);
      }
    })
  );
}

export function deactivate() {}
