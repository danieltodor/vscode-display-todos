import * as assert from "assert";
import * as vscode from "vscode";
import { activate, deactivate } from "../extension";
import { cleanupProvisionedWorkspace, cleanupTestFiles, ensureWorkspaceRoot } from "./test-helpers";

suite("Extension", () =>
{
    suiteSetup(async () =>
    {
        await ensureWorkspaceRoot();
        await cleanupTestFiles();
    });

    suiteTeardown(async () =>
    {
        await cleanupTestFiles();
        await cleanupProvisionedWorkspace();
    });

    test("activate registers disposables", () =>
    {
        const subscriptions: vscode.Disposable[] = [];
        const context = { subscriptions } as unknown as vscode.ExtensionContext;

        activate(context);

        assert.ok(subscriptions.length > 0);

        for (const disposable of subscriptions.splice(0))
        {
            disposable.dispose();
        }
    });

    test("deactivate is a no-op", () =>
    {
        assert.doesNotThrow(() => deactivate());
    });
});
