import * as os from 'os';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utillities';

export async function activate(context: vscode.ExtensionContext) {
  const commandsToCheck = ['jsonnet', 'jq', 'yq'];
  const missing: string[] = [];

  for (const cmd of commandsToCheck) {
    const ok = await utils.checkCommandAvailable(cmd);
    if (!ok) {
      missing.push(cmd);
    }
  }

  if (missing.length > 0) {
    vscode.window.showWarningMessage(
      `Jsonnet Renderer: Missing required tools: ${missing.join(', ')}. Please install them and reload.`
    );
    return;
  }

  const virtualDocs = new Map<string, string>();

  const provider = vscode.workspace.registerTextDocumentContentProvider('rendered', {
    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
      return virtualDocs.get(uri.toString()) || '';
    }
  });

  vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.uri.scheme === 'rendered') {
      virtualDocs.delete(doc.uri.toString());
    }
  });

  context.subscriptions.push(provider);

  const disposable = vscode.commands.registerCommand('jsonnetRenderer.renderFile', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;

    if (!filePath.endsWith('.jsonnet') && !filePath.endsWith('.libsonnet')) {
      vscode.window.showErrorMessage('Not a Jsonnet/libsonnet file.');
      return;
    }

    try {
      const jsonOutput = await utils.execCommand('jsonnet', [filePath]);

      // Try to detect what structure we’re dealing with
      let parsed: any;
      try {
        parsed = JSON.parse(jsonOutput);
      } catch (err) {
        throw new Error("Failed to parse JSON output from jsonnet.");
      }

      let documents: any[] = [];

      if (Array.isArray(parsed)) {
        documents = parsed;
      } else if (parsed.items && Array.isArray(parsed.items)) {
        documents = parsed.items;
      } else {
        documents = [parsed];
      }

      // Convert each document to YAML
      let yamlOutput = '';
      let first = false;
      for (const doc of documents) {
        const yaml = await utils.convertToYaml(doc);
        if (first === false) {
          yamlOutput += `${yaml}\n---\n`;
        }
        else {
          first = false;
        }
      }

      const originalName = path.basename(filePath, path.extname(filePath));
      const timestamp = utils.getLocalTimestamp();
      const virtualFilename = `rendered_${timestamp}_${originalName}.yaml`;
      const virtualUri = vscode.Uri.parse(`rendered:${virtualFilename}`);

      // Register YAML content for this virtual doc
      virtualDocs.set(virtualUri.toString(), yamlOutput);

      // Open the virtual document
      const doc = await vscode.workspace.openTextDocument(virtualUri);
      vscode.window.showTextDocument(doc, { preview: false });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Render failed: ${err.message}`);
    }
  });

  const compareDisposable = vscode.commands.registerCommand('jsonnetRenderer.renderAndCompare', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;

    if (!filePath.endsWith('.jsonnet') && !filePath.endsWith('.libsonnet')) {
      vscode.window.showErrorMessage('Not a Jsonnet/libsonnet file.');
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('File must be inside a workspace folder.');
      return;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath).replace(/\\/g, '/');
    const base = path.basename(filePath, path.extname(filePath));

    // Create a unique worktree directory
    const tempWorktreePath = path.join(os.tmpdir(), `jsonnet-head-${Date.now()}-${Math.random().toString(36).substring(2)}`);

    try {
      // Step 1: Create Git worktree at HEAD
      await utils.execCommand('git', ['worktree', 'add', tempWorktreePath, 'HEAD'], undefined, workspaceFolder.uri.fsPath);

      // Step 2: Find equivalent file path in the worktree
      const headFilePath = path.join(tempWorktreePath, relativePath);

      // Step 3: Render the file from the worktree
      const originalJson = await utils.execCommand('jsonnet', [headFilePath]);
      const originalParsed = JSON.parse(originalJson);
      const originalYaml = await utils.convertToYaml(originalParsed);

      // Step 4: Render the current version from the workspace
      const currentJson = await utils.execCommand('jsonnet', [filePath]);
      const currentParsed = JSON.parse(currentJson);
      const currentYaml = await utils.convertToYaml(currentParsed);

      // Step 5: Clean up the worktree
      try {
        await utils.execCommand('git', ['worktree', 'remove', '--force', tempWorktreePath], undefined, workspaceFolder.uri.fsPath);
        await fs.rm(tempWorktreePath, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('Failed to fully clean up worktree:', cleanupErr);
      }

      // Step 6: Open diff view
      const timestamp = utils.getLocalTimestamp();
      const uriA = vscode.Uri.parse(`rendered:original_${timestamp}_${base}.yaml`);
      const uriB = vscode.Uri.parse(`rendered:current_${timestamp}_${base}.yaml`);

      virtualDocs.set(uriA.toString(), originalYaml);
      virtualDocs.set(uriB.toString(), currentYaml);

      await vscode.commands.executeCommand('vscode.diff', uriA, uriB, `Diff: original ↔ current (${base})`);

    } catch (err: any) {
      vscode.window.showErrorMessage(`Compare failed: ${err.message}`);
      try {
        await fs.rm(tempWorktreePath, { recursive: true, force: true });
      } catch {}
    }
  });

  context.subscriptions.push(compareDisposable);
  context.subscriptions.push(disposable);
}

export function deactivate() { }
