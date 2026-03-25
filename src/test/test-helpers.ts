import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ScanConfig } from "../scanner";

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

export const DEFAULT_CONFIG: ScanConfig = readDefaultConfigFromPackageJson();

export const TEST_ROOT_DIR = ".tmp-display-todos-tests";

let provisionedWorkspaceRoot: vscode.Uri | undefined;
let provisionedWorkspaceFolderName: string | undefined;

export async function docFromText(content: string): Promise<vscode.TextDocument>
{
    return vscode.workspace.openTextDocument({ content, language: "plaintext" });
}

export async function ensureWorkspaceRoot(): Promise<vscode.Uri>
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
        const folder = vscode.workspace.workspaceFolders?.find((workspaceFolder) =>
            workspaceFolder.uri.toString() === tempUri.toString()
        );
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

export async function testFileUri(relativePath: string): Promise<vscode.Uri>
{
    const root = await ensureWorkspaceRoot();
    return vscode.Uri.joinPath(root, TEST_ROOT_DIR, relativePath);
}

export async function writeTestFile(relativePath: string, content: string): Promise<vscode.Uri>
{
    const uri = await testFileUri(relativePath);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    return uri;
}

export async function writeBinaryTestFile(relativePath: string, bytes: Uint8Array): Promise<vscode.Uri>
{
    const uri = await testFileUri(relativePath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

export async function cleanupTestFiles(): Promise<void>
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

export async function cleanupProvisionedWorkspace(): Promise<void>
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
