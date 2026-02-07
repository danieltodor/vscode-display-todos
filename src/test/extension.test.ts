import * as assert from "assert";
import * as vscode from "vscode";
import { scanDocument, ScanConfig } from "../../src/scanner";

const DEFAULT_CONFIG: ScanConfig = {
  keywords: [
    { keyword: "FIXME", severity: "error" },
    { keyword: "BUG", severity: "error" },
    { keyword: "TODO", severity: "warning" },
    { keyword: "HACK", severity: "warning" },
    { keyword: "XXX", severity: "warning" },
  ],
  include: "**/*",
  exclude: "**/node_modules/**",
};

/**
 * Helper: create a TextDocument-like object from raw text content.
 */
async function docFromText(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content, language: "plaintext" });
}

suite("Scanner — scanDocument", () => {
  test("detects a TODO comment", async () => {
    const doc = await docFromText("// TODO: fix this later");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "TODO: fix this later");
    assert.strictEqual(
      diagnostics[0].severity,
      vscode.DiagnosticSeverity.Warning
    );
    assert.strictEqual(diagnostics[0].source, "Search TODOs");
  });

  test("detects a FIXME comment as error", async () => {
    const doc = await docFromText("// FIXME: urgent issue");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "FIXME: urgent issue");
    assert.strictEqual(
      diagnostics[0].severity,
      vscode.DiagnosticSeverity.Error
    );
  });

  test("detects a BUG comment as error", async () => {
    const doc = await docFromText("# BUG: off-by-one");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "BUG: off-by-one");
    assert.strictEqual(
      diagnostics[0].severity,
      vscode.DiagnosticSeverity.Error
    );
  });

  test("returns no diagnostics for lines without keywords", async () => {
    const doc = await docFromText(
      "const x = 1;\nfunction hello() { return 42; }"
    );
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 0);
  });

  test("is case-insensitive", async () => {
    const doc = await docFromText("// todo: lowercase works too");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "TODO: lowercase works too");
  });

  test("handles keyword without trailing text", async () => {
    const doc = await docFromText("// TODO");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, "TODO");
  });

  test("detects multiple keywords across lines", async () => {
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

  test("returns empty array when keywords config is empty", async () => {
    const doc = await docFromText("// TODO: should not match");
    const emptyConfig: ScanConfig = { ...DEFAULT_CONFIG, keywords: [] };
    const diagnostics = scanDocument(doc, emptyConfig);
    assert.strictEqual(diagnostics.length, 0);
  });

  test("works with custom keyword config", async () => {
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

  test("positions range correctly on the line", async () => {
    const doc = await docFromText("    // TODO: indented");
    const diagnostics = scanDocument(doc, DEFAULT_CONFIG);
    assert.strictEqual(diagnostics.length, 1);
    // "TODO: indented" starts at column 7
    assert.strictEqual(diagnostics[0].range.start.character, 7);
  });
});
