import * as assert from "assert";
import * as vscode from "vscode";
import {
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
import {
    cleanupProvisionedWorkspace,
    cleanupTestFiles,
    DEFAULT_CONFIG,
    docFromText,
    ensureWorkspaceRoot,
    TEST_ROOT_DIR,
    writeBinaryTestFile,
    writeTestFile
} from "./test-helpers";

suite("Scanner - scanDocument", () =>
{
    test("detects a TODO comment", async () =>
    {
        const doc = await docFromText("// TODO: fix this later");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "TODO: fix this later");
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
        assert.strictEqual(diagnostics[0].source, "Disрlаy TОDОs");
    });

    test("detects a FIXME comment as error", async () =>
    {
        const doc = await docFromText("// FIXME: urgent issue");
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "FIXME: urgent issue");
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
    });

    test("returns no diagnostics for lines without keywords", async () =>
    {
        const doc = await docFromText("const x = 1;\nfunction hello() { return 42; }");
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
            "// XXX: review this"
        ].join("\n");
        const doc = await docFromText(content);
        const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
        assert.strictEqual(diagnostics.length, 4);

        const messages = diagnostics.map((diagnostic) => diagnostic.message);
        assert.ok(messages.some((message) => message.startsWith("TODO")));
        assert.ok(messages.some((message) => message.startsWith("FIXME")));
        assert.ok(messages.some((message) => message.startsWith("HACK")));
        assert.ok(messages.some((message) => message.startsWith("XXX")));
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
            keywords: [{ keyword: "NOTE", severity: "info" }]
        };
        const diagnostics = scanDocument(doc, customConfig);
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, "NOTE: remember this");
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Information);
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
        const diagnostic = diagnostics[0];

        const compiled = compileConfig(DEFAULT_CONFIG);
        const match = compiled.pattern.exec(line);
        assert.ok(match);

        const expectedStart = match.index;
        const expectedEnd = match.index + match[0].trimEnd().length;

        assert.strictEqual(diagnostic.range.start.character, expectedStart);
        assert.strictEqual(diagnostic.range.end.character, expectedEnd);
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
            keywords: [{ keyword: "ODD", severity: "warning" }]
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
            { line: "TODO asd", message: "TODO: asd" },
            { line: "   TODO", message: "TODO" },
            { line: "\tTODO", message: "TODO" },
            { line: "// TODO asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO: asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "//TODO", message: "TODO" },
            { line: "// TODO", message: "TODO" },
            { line: "#TODO", message: "TODO" },
            { line: "# TODO", message: "TODO" },
            { line: "TODO", message: "TODO" },
            { line: "TODO asdasd", message: "TODO: asdasd" },
            { line: "-- TODO", message: "TODO" },
            { line: "; TODO", message: "TODO" },
            { line: "' TODO", message: "TODO" },
            { line: "% TODO", message: "TODO" },
            { line: "/* TODO", message: "TODO" },
            { line: "<!-- TODO", message: "TODO" },
            { line: "{- TODO", message: "TODO" },
            { line: "(* TODO", message: "TODO" },
            { line: "=begin TODO", message: "TODO" },
            { line: "REM TODO", message: "TODO" },
            { line: "asas asdasd// TODO asd", message: "TODO: asd" }
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
            diagnostics.map((diagnostic) => diagnostic.range.start.line),
            mustMatch.map((_, index) => index)
        );

        assert.deepStrictEqual(
            diagnostics.map((diagnostic) => diagnostic.message),
            mustMatch.map((entry) => entry.message)
        );
    });
});

suite("Scanner - compile + text scanning", () =>
{
    test("compileConfig with empty keywords creates never-matching pattern", () =>
    {
        const compiled = compileConfig({ ...DEFAULT_CONFIG, keywords: [] });
        assert.strictEqual(compiled.keywordProbe.test("TODO"), false);
        const diagnostics = scanText("// TODO: should not match", compiled);
        assert.strictEqual(diagnostics.length, 0);
    });

    test("compileConfig creates a keyword probe that preserves case sensitivity", () =>
    {
        const caseSensitive = compileConfig({
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "TODO", severity: "warning" }],
            caseSensitive: true
        });
        assert.strictEqual(caseSensitive.keywordProbe.test("TODO later"), true);
        assert.strictEqual(caseSensitive.keywordProbe.test("todo later"), false);

        const caseInsensitive = compileConfig({
            ...DEFAULT_CONFIG,
            keywords: [{ keyword: "TODO", severity: "warning" }],
            caseSensitive: false
        });
        assert.strictEqual(caseInsensitive.keywordProbe.test("todo later"), true);
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
            { line: "TODO asd", message: "TODO: asd" },
            { line: "   TODO", message: "TODO" },
            { line: "\tTODO", message: "TODO" },
            { line: "// TODO asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "// TODO: asdasd sdsdf sdfsdf", message: "TODO: asdasd sdsdf sdfsdf" },
            { line: "//TODO", message: "TODO" },
            { line: "// TODO", message: "TODO" },
            { line: "#TODO", message: "TODO" },
            { line: "# TODO", message: "TODO" },
            { line: "TODO", message: "TODO" },
            { line: "TODO asdasd", message: "TODO: asdasd" },
            { line: "-- TODO", message: "TODO" },
            { line: "; TODO", message: "TODO" },
            { line: "' TODO", message: "TODO" },
            { line: "% TODO", message: "TODO" },
            { line: "/* TODO", message: "TODO" },
            { line: "<!-- TODO", message: "TODO" },
            { line: "{- TODO", message: "TODO" },
            { line: "(* TODO", message: "TODO" },
            { line: "=begin TODO", message: "TODO" },
            { line: "REM TODO", message: "TODO" },
            { line: "asas asdasd// TODO asd", message: "TODO: asd" }
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
            docDiagnostics.map((diagnostic) => ({
                line: diagnostic.range.start.line,
                message: diagnostic.message,
                severity: diagnostic.severity
            })),
            textDiagnostics.map((diagnostic) => ({
                line: diagnostic.range.start.line,
                message: diagnostic.message,
                severity: diagnostic.severity
            }))
        );
    });
});

suite("Scanner - scope and globs", () =>
{
    test("isPathInScope treats empty include as include-all", () =>
    {
        assert.strictEqual(isPathInScope("src/file.ts", [], ["**/node_modules/**"]), true);
        assert.strictEqual(isPathInScope("node_modules/pkg/index.ts", [], ["**/node_modules/**"]), false);
    });

    test("isPathInScope respects include and exclude patterns", () =>
    {
        assert.strictEqual(isPathInScope("src/file.ts", ["src/**/*.ts"], []), true);
        assert.strictEqual(isPathInScope("src/file.js", ["src/**/*.ts"], []), false);
        assert.strictEqual(isPathInScope("src/generated/file.ts", ["src/**/*.ts"], ["src/generated/**"]), false);
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

suite("Scanner - workspace scan", () =>
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
            exclude: [`${TEST_ROOT_DIR}/glob/**/*.ignore`]
        });

        const asStrings = uris.map((uri) => uri.toString());
        assert.ok(asStrings.includes(included.toString()));
        assert.ok(!asStrings.some((uri) => uri.endsWith("excluded.ignore")));
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
                exclude: []
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
                exclude: []
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
                exclude: []
            },
            inScopeUris,
            cts.token
        );

        assert.strictEqual(collection.get(vscode.Uri.parse("file:///stale"))?.length ?? 0, 0);
        assert.strictEqual(inScopeUris.size, 0);
    });

    test("scanWorkspace does not retain batch scope entries after cancellation", async () =>
    {
        await writeTestFile("scan/cancel-batch-one.ts", "// TODO: first\n");
        await writeTestFile("scan/cancel-batch-two.ts", "// TODO: second\n");

        let readCount = 0;
        const token: vscode.CancellationToken = {
            get isCancellationRequested()
            {
                readCount++;
                return readCount >= 5;
            },
            onCancellationRequested: () => ({ dispose() { } })
        };

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/scan/cancel-batch-*.ts`],
                exclude: []
            },
            inScopeUris,
            token
        );

        assert.strictEqual(inScopeUris.size, 0);
    });

    test("scanWorkspace stops the open-document pass when cancelled", async () =>
    {
        const firstUri = await writeTestFile("open-docs/first.ts", "// TODO: first\n");
        const secondUri = await writeTestFile("open-docs/second.ts", "// TODO: second\n");

        await vscode.workspace.openTextDocument(firstUri);
        await vscode.workspace.openTextDocument(secondUri);

        const openDocs = vscode.workspace.textDocuments;
        const firstIndex = openDocs.findIndex((document) => document.uri.toString() === firstUri.toString());
        const secondIndex = openDocs.findIndex((document) => document.uri.toString() === secondUri.toString());

        assert.ok(firstIndex >= 0);
        assert.ok(secondIndex >= 0);

        const [scannedUri, skippedUri, skippedIndex] = firstIndex < secondIndex
            ? [firstUri, secondUri, secondIndex]
            : [secondUri, firstUri, firstIndex];

        let readCount = 0;
        const token: vscode.CancellationToken = {
            get isCancellationRequested()
            {
                readCount++;
                return readCount >= 4 + skippedIndex;
            },
            onCancellationRequested: () => ({ dispose() { } })
        };

        await scanWorkspace(
            collection,
            {
                ...DEFAULT_CONFIG,
                include: [`${TEST_ROOT_DIR}/does-not-match/**/*.ts`],
                exclude: []
            },
            inScopeUris,
            token
        );

        assert.strictEqual(collection.get(scannedUri)?.length ?? 0, 1);
        assert.strictEqual(collection.get(skippedUri)?.length ?? 0, 0);
        assert.ok(inScopeUris.has(scannedUri.toString()));
        assert.ok(!inScopeUris.has(skippedUri.toString()));
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
                exclude: []
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
                exclude: []
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
