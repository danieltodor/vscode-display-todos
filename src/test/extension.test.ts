import * as assert from "assert";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import
{
    compileConfig,
    getFileUris,
    isPathInScope,
    matchesScope,
    scanDocument,
    scanText,
    scanWorkspace,
    ScanConfig,
    toGlob
} from "../scanner";

type PackageJsonConfigProperty<T> = {
    default?: T;
};

type PackageJsonShape = {
    contributes?: {
        configuration?: {
            properties?: {
                "displayTodos.keywords"?: PackageJsonConfigProperty<ScanConfig["keywords"]>;
                "displayTodos.include"?: PackageJsonConfigProperty<string[]>;
                "displayTodos.exclude"?: PackageJsonConfigProperty<string[]>;
                "displayTodos.pattern"?: PackageJsonConfigProperty<string>;
                "displayTodos.caseSensitive"?: PackageJsonConfigProperty<boolean>;
            };
        };
    };
};

function readDefaultConfigFromPackageJson(): ScanConfig
{
    const packageJsonPath = path.resolve(__dirname, "../../package.json");
    const packageJsonRaw = fsSync.readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as PackageJsonShape;
    const props = packageJson.contributes?.configuration?.properties;

    return {
        keywords: props?.["displayTodos.keywords"]?.default ?? [],
        include: props?.["displayTodos.include"]?.default ?? [],
        exclude: props?.["displayTodos.exclude"]?.default ?? [],
        pattern: props?.["displayTodos.pattern"]?.default ?? "",
        caseSensitive: props?.["displayTodos.caseSensitive"]?.default ?? true
    };
}

const DEFAULT_CONFIG: ScanConfig = readDefaultConfigFromPackageJson();

const TEST_ROOT_DIR = ".tmp-display-todos-tests";

let provisionedWorkspaceRoot: vscode.Uri | undefined;
let provisionedWorkspaceFolderName: string | undefined;

/**
 * Helper: create a TextDocument-like object from raw text content.
 */
async function docFromText(content: string): Promise<vscode.TextDocument>
{
    return vscode.workspace.openTextDocument({ content, language: "plaintext" });
}

async function ensureWorkspaceRoot(): Promise<vscode.Uri>
{
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root)
    {
        return root;
    }

    if (provisionedWorkspaceRoot)
    {
        return provisionedWorkspaceRoot;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "display-todos-tests-"));
    const tempUri = vscode.Uri.file(tempDir);
    const folderName = `display-todos-tests-${Date.now()}`;

    const added = vscode.workspace.updateWorkspaceFolders(
        0,
        0,
        { uri: tempUri, name: folderName }
    );
    if (!added)
    {
        throw new Error("Could not add temporary workspace folder for tests.");
    }

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline)
    {
        const folder = vscode.workspace.workspaceFolders?.find((w) => w.uri.toString() === tempUri.toString());
        if (folder)
        {
            provisionedWorkspaceRoot = folder.uri;
            provisionedWorkspaceFolderName = folder.name;
            return folder.uri;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error("Temporary workspace folder did not become available in time.");
}

async function testFileUri(relativePath: string): Promise<vscode.Uri>
{
    const root = await ensureWorkspaceRoot();
    return vscode.Uri.joinPath(root, TEST_ROOT_DIR, relativePath);
}

async function writeTestFile(relativePath: string, content: string): Promise<vscode.Uri>
{
    const uri = await testFileUri(relativePath);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    return uri;
}

async function writeBinaryTestFile(relativePath: string, bytes: Uint8Array): Promise<vscode.Uri>
{
    const uri = await testFileUri(relativePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

async function cleanupTestFiles(): Promise<void>
{
    try
    {
        const root = await ensureWorkspaceRoot();
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(root, TEST_ROOT_DIR), { recursive: true, useTrash: false });
    } catch
    {
        // Directory may not exist.
    }
}

async function cleanupProvisionedWorkspace(): Promise<void>
{
    if (!provisionedWorkspaceRoot)
    {
        return;
    }

    try
    {
        await vscode.workspace.fs.delete(provisionedWorkspaceRoot, { recursive: true, useTrash: false });
    } catch
    {
        // Best-effort cleanup.
    }

    const index = vscode.workspace.workspaceFolders?.findIndex((folder) =>
        folder.uri.toString() === provisionedWorkspaceRoot?.toString()
        || folder.name === provisionedWorkspaceFolderName
    ) ?? -1;

    if (index >= 0)
    {
        vscode.workspace.updateWorkspaceFolders(index, 1);
    }

    provisionedWorkspaceRoot = undefined;
    provisionedWorkspaceFolderName = undefined;
}

suite("Scanner — scanDocument", () =>
{
    test("detects a TODO comment", async () =>
    {
        const doc = await docFromText("// TODO: fix this later");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: fix this later");
        assert.strictEqual(
            diagnostics[0].severity,
            vscode.DiagnosticSeverity.Warning
        );
        assert.strictEqual(diagnostics[0].source, "Disрlаy TОDОs");
    });

    test("detects a FIXME comment as error", async () =>
    {
        const doc = await docFromText("// FIXME: urgent issue");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "FIXME: urgent issue");
        assert.strictEqual(
            diagnostics[0].severity,
            vscode.DiagnosticSeverity.Error
        );
    });

    test("detects a BUG comment as error", async () =>
    {
        const doc = await docFromText("# BUG: off-by-one");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "BUG: off-by-one");
        assert.strictEqual(
            diagnostics[0].severity,
            vscode.DiagnosticSeverity.Error
        );
    });

    test("returns no diagnostics for lines without keywords", async () =>
    {
        const doc = await docFromText(
            "const x = 1;\nfunction hello() { return 42; }"
        );
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 0);
    });

    test("is case-sensitive by default", async () =>
    {
        const doc = await docFromText("// todo: lowercase should not match");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 0);
    });

    test("matches case-insensitively when configured", async () =>
    {
        const doc = await docFromText("// todo: lowercase works too");
        const ciConfig: ScanConfig = { ...DEFAULT_CONFIG, caseSensitive: false };
        const diagnostics = scanDocument(doc, ciConfig);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: lowercase works too");
    });

    test("handles keyword without trailing text", async () =>
    {
        const doc = await docFromText("// TODO");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO");
    });

    test("detects multiple keywords across lines", async () =>
    {
        const content = [
            "// TODO: first task",
            "const a = 1;",
            "// FIXME: broken",
            "// HACK: workaround",
            "console.log('hello');",
            "// XXX: review this",
        ].join("\n");
        const doc = await docFromText(content);
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 4);

        // Verify correct keywords found
        const messages = diagnostics.map((d) => d.message);
        assert.ok(messages.some((m) => m.startsWith("TODO")));
        assert.ok(messages.some((m) => m.startsWith("FIXME")));
        assert.ok(messages.some((m) => m.startsWith("HACK")));
        assert.ok(messages.some((m) => m.startsWith("XXX")));
    });

    test("returns empty array when keywords config is empty", async () =>
    {
        const doc = await docFromText("// TODO: should not match");
        const emptyConfig: ScanConfig = { ...DEFAULT_CONFIG, keywords: [] };
        const diagnostics = scanDocument(doc, emptyConfig);
        assert.strictEqual(diagnostics.length, 0);
    });

    test("works with custom keyword config", async () =>
    {
        const doc = await docFromText("// NOTE: remember this");
        const customConfig: ScanConfig = {
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "NOTE", severity: "info" }],
        };
        const diagnostics = scanDocument(doc, customConfig);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "NOTE: remember this");
        assert.strictEqual(
            diagnostics[0].severity,
            vscode.DiagnosticSeverity.Information
        );
    });

    test("positions range correctly on the line", async () =>
    {
        const line = "    // TODO: indented";
        const doc = await docFromText(line);
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);

        const compiled = compileConfig(DEFAULT_CONFIG);
        const match = compiled.pattern.exec(line);
        assert.ok(match);
        assert.strictEqual(diagnostics[0].range.start.character, match.index);
    });

    test("range end excludes trailing spaces", async () =>
    {
        const line = "// TODO: trim me    ";
        const doc = await docFromText(line);
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        const diag = diagnostics[0];

        const compiled = compileConfig(DEFAULT_CONFIG);
        const match = compiled.pattern.exec(line);
        assert.ok(match);

        const expectedStart = match.index;
        const expectedEnd = match.index + match[0].trimEnd().length;

        assert.strictEqual(diag.range.start.character, expectedStart);
        assert.strictEqual(diag.range.end.character, expectedEnd);
    });

    test("matches only the first keyword occurrence per line", async () =>
    {
        const doc = await docFromText("// TODO: first TODO: second");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: first TODO: second");
    });

    test("falls back to warning severity for unknown runtime severity", async () =>
    {
        const doc = await docFromText("// ODD: custom severity");
        const customConfig: ScanConfig = {
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "ODD", severity: "warning" }],
        };

        (customConfig.keywords[0] as { keyword: string; severity: string; }).severity = "critical";

        const diagnostics = scanDocument(doc, customConfig);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
    });

    test("updated default-style pattern matches and rejects expected TODO forms", async () =>
    {
        const strictPatternConfig: ScanConfig = {
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "TODO", severity: "warning" }],
            pattern: DEFAULT_CONFIG.pattern
        };

        const mustMatch = [
            { line: "// TODO asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO: asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO", message: "TODO" },
            { line: "//TODO", message: "TODO" },
            { line: "#TODO", message: "TODO" },
            { line: "# TODO", message: "TODO" },
            { line: "TODO", message: "TODO" },
            { line: "TODO asdasd", message: "TODO: asdasd" }
        ];

        const mustNotMatch = [
            "// TODO-asdasd",
            "// TODOs",
            "// TODO\"",
            "// TODO'",
            "asdasd TODO asdasd"
        ];

        const doc = await docFromText([
            ...mustMatch.map((entry) => entry.line),
            ...mustNotMatch
        ].join("\n"));
        const diagnostics = scanDocument(doc, strictPatternConfig);

        assert.deepStrictEqual(
            diagnostics.map((d) => d.range.start.line),
            mustMatch.map((_, index) => index)
        );

        assert.deepStrictEqual(
            diagnostics.map((d) => d.message),
            mustMatch.map((entry) => entry.message)
        );
    });
});

suite("Scanner — compile + text scanning", () =>
{
    test("compileConfig with empty keywords creates never-matching pattern", () =>
    {
        const compiled = compileConfig({ ...DEFAULT_CONFIG, keywords: [] });
        const diagnostics = scanText("// TODO: should not match", compiled);
        assert.strictEqual(diagnostics.length, 0);
    });

    test("scanText respects case-insensitive matching and preserves configured source", () =>
    {
        const compiled = compileConfig({
            ...DEFAULT_CONFIG,
            caseSensitive: false
        });
        const diagnostics = scanText("# todo: lower-case", compiled);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: lower-case");
    });

    test("updated default-style pattern matches and rejects expected TODO forms", () =>
    {
        const strictPatternConfig: ScanConfig = {
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "TODO", severity: "warning" }],
            pattern: DEFAULT_CONFIG.pattern
        };

        const compiled = compileConfig(strictPatternConfig);

        const mustMatch = [
            { line: "// TODO asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO: asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO", message: "TODO" },
            { line: "//TODO", message: "TODO" },
            { line: "#TODO", message: "TODO" },
            { line: "# TODO", message: "TODO" },
            { line: "TODO", message: "TODO" },
            { line: "TODO asdasd", message: "TODO: asdasd" }
        ];

        const mustNotMatch = [
            "// TODO-asdasd",
            "// TODOs",
            "// TODO\"",
            "// TODO'",
            "asdasd TODO asdasd"
        ];

        for (const { line } of mustMatch)
        {
            const diagnostics = scanText(line, compiled);
            assert.strictEqual(diagnostics.length, 1, `Expected match for: ${line}`);
        }

        assert.deepStrictEqual(
            mustMatch.map((entry) => (scanText(entry.line, compiled)[0]?.message ?? "")),
            mustMatch.map((entry) => entry.message)
        );

        for (const line of mustNotMatch)
        {
            const diagnostics = scanText(line, compiled);
            assert.strictEqual(diagnostics.length, 0, `Expected no match for: ${line}`);
        }
    });

    test("scanText and scanDocument return equivalent diagnostics", async () =>
    {
        const strictPatternConfig: ScanConfig = {
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "TODO", severity: "warning" }],
            pattern: DEFAULT_CONFIG.pattern
        };

        const input = [
            "// TODO first",
            "asdasd TODO asdasd",
            "# TODO: second",
            "// TODOs"
        ].join("\n");

        const compiled = compileConfig(strictPatternConfig);
        const textDiagnostics = scanText(input, compiled);
        const doc = await docFromText(input);
        const docDiagnostics = scanDocument(doc, strictPatternConfig);

        assert.deepStrictEqual(
            docDiagnostics.map((d) => ({ line: d.range.start.line, message: d.message, severity: d.severity })),
            textDiagnostics.map((d) => ({ line: d.range.start.line, message: d.message, severity: d.severity }))
        );
    });
});

suite("Scanner — scope and globs", () =>
{
    test("isPathInScope treats empty include as include-all", () =>
    {
        assert.strictEqual(
            isPathInScope("src/file.ts", [], ["**/node_modules/**"]),
            true
        );
        assert.strictEqual(
            isPathInScope("node_modules/pkg/index.ts", [], ["**/node_modules/**"]),
            false
        );
    });

    test("isPathInScope respects include and exclude patterns", () =>
    {
        assert.strictEqual(
            isPathInScope("src/file.ts", ["src/**/*.ts"], []),
            true
        );
        assert.strictEqual(
            isPathInScope("src/file.js", ["src/**/*.ts"], []),
            false
        );
        assert.strictEqual(
            isPathInScope("src/generated/file.ts", ["src/**/*.ts"], ["src/generated/**"]),
            false
        );
    });

    test("matchesScope rejects non-file URIs", () =>
    {
        assert.strictEqual(matchesScope(vscode.Uri.parse("untitled:test"), DEFAULT_CONFIG), false);
    });

    test("isPathInScope includes dotfiles with dot=true matching", () =>
    {
        assert.strictEqual(isPathInScope(".github/workflows/ci.yml", ["**/*"], []), true);
    });

    test("toGlob handles empty, single and multi pattern inputs", () =>
    {
        assert.strictEqual(toGlob([]), "");
        assert.strictEqual(toGlob(["src/**/*.ts"]), "src/**/*.ts");
        assert.strictEqual(toGlob([" src/**/*.ts ", "", "**/*.md"]), "{src/**/*.ts,**/*.md}");
    });
});

suite("Scanner — workspace scan", () =>
{
    let collection: vscode.DiagnosticCollection;
    let inScopeUris: Set<string>;

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

    setup(async () =>
    {
        collection = vscode.languages.createDiagnosticCollection("display-todos-tests");
        inScopeUris = new Set<string>();
        await cleanupTestFiles();
    });

    teardown(async () =>
    {
        collection.dispose();
        await cleanupTestFiles();
    });

    test("getFileUris returns files constrained by include and exclude globs", async () =>
    {
        const included = await writeTestFile("glob/include.ts", "// TODO: include");
        await writeTestFile("glob/excluded.ignore", "// TODO: excluded");

        const uris = await getFileUris({
            ...DEFAULT_CONFIG,
            include: [`${TEST_ROOT_DIR}/glob/**/*`],
            exclude: [`${TEST_ROOT_DIR}/glob/**/*.ignore`],
        });

        const asStrings = uris.map((u) => u.toString());
        assert.ok(asStrings.includes(included.toString()));
        assert.ok(!asStrings.some((u) => u.endsWith("excluded.ignore")));
    });

    test("scanWorkspace scans included files and tracks in-scope URIs", async () =>
    {
        const todoUri = await writeTestFile("scan/one.ts", "// TODO: alpha");
        const noTodoUri = await writeTestFile("scan/two.ts", "const x = 1;");

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/**/*.ts`],
                exclude: [],
            },
            inScopeUris
        );

        assert.ok(inScopeUris.has(todoUri.toString()));
        assert.ok(inScopeUris.has(noTodoUri.toString()));

        const todoDiagnostics = collection.get(todoUri) ?? [];
        assert.strictEqual(todoDiagnostics.length, 1);
        assert.strictEqual(todoDiagnostics[0].message, "TODO: alpha");

        const noTodoDiagnostics = collection.get(noTodoUri) ?? [];
        assert.strictEqual(noTodoDiagnostics.length, 0);
    });

    test("scanWorkspace prefers open unsaved document content over disk content", async () =>
    {
        const uri = await writeTestFile("scan/unsaved.ts", "const value = 1;\n");
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);

        const edit = new vscode.WorkspaceEdit();
        const end = document.positionAt(document.getText().length);
        edit.insert(uri, end, "// TODO: from unsaved buffer\n");
        const applied = await vscode.workspace.applyEdit(edit);
        assert.strictEqual(applied, true);

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/**/*.ts`],
                exclude: [],
            },
            inScopeUris
        );

        const diagnostics = collection.get(uri) ?? [];
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: from unsaved buffer");
    });

    test("scanWorkspace with pre-cancelled token returns after clearing state", async () =>
    {
        await writeTestFile("scan/cancelled.ts", "// TODO: should not be scanned\n");

        collection.set(vscode.Uri.parse("file:///stale"), [
            new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
                "stale",
                vscode.DiagnosticSeverity.Warning
            )
        ]);
        inScopeUris.add("file:///stale");

        const cts = new vscode.CancellationTokenSource();
        cts.cancel();

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/**/*.ts`],
                exclude: [],
            },
            inScopeUris,
            cts.token
        );

        assert.strictEqual(collection.get(vscode.Uri.parse("file:///stale"))?.length ?? 0, 0);
        assert.strictEqual(inScopeUris.size, 0);
    });

    test("scanWorkspace skips binary files by extension", async () =>
    {
        const textUri = await writeTestFile("scan/mixed.ts", "// TODO: should be detected\n");
        const binaryByExtensionUri = await writeBinaryTestFile(
            "scan/image.png",
            new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0x54, 0x4F, 0x44, 0x4F])
        );

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/**/*`],
                exclude: [],
            },
            inScopeUris
        );

        const textDiagnostics = collection.get(textUri) ?? [];
        assert.strictEqual(textDiagnostics.length, 1);
        assert.strictEqual(textDiagnostics[0].message, "TODO: should be detected");

        const binaryDiagnostics = collection.get(binaryByExtensionUri) ?? [];
        assert.strictEqual(binaryDiagnostics.length, 0);
        assert.ok(inScopeUris.has(binaryByExtensionUri.toString()));
    });

    test("scanWorkspace skips binary files by byte heuristic", async () =>
    {
        const textUri = await writeTestFile("scan/heuristic-text.txt", "TODO: text file should be scanned\n");
        const binaryHeuristicUri = await writeBinaryTestFile(
            "scan/no-extension-bin",
            new Uint8Array([0x00, 0x54, 0x4F, 0x44, 0x4F, 0x3A, 0x20, 0x68, 0x69])
        );

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/**/*`],
                exclude: [],
            },
            inScopeUris
        );

        const textDiagnostics = collection.get(textUri) ?? [];
        assert.strictEqual(textDiagnostics.length, 1);
        assert.strictEqual(textDiagnostics[0].message, "TODO: text file should be scanned");

        const binaryDiagnostics = collection.get(binaryHeuristicUri) ?? [];
        assert.strictEqual(binaryDiagnostics.length, 0);
        assert.ok(inScopeUris.has(binaryHeuristicUri.toString()));
    });
});
