import * as os from 'os';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import * as path from 'path';
import * as utils from './utilities';

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
  const previewSessions = new Map<string, { virtualUri: vscode.Uri; watcher: vscode.Disposable }>();

  const changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: changeEmitter.event,
    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
      return virtualDocs.get(uri.toString()) || '';
    }
  };
  const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('rendered', provider);

  vscode.workspace.onDidCloseTextDocument((doc) => {
    if (doc.uri.scheme === 'rendered') {
      virtualDocs.delete(doc.uri.toString());
      for (const [file, session] of previewSessions) {
        if (session.virtualUri.toString() === doc.uri.toString()) {
          session.watcher.dispose();
          previewSessions.delete(file);
          break;
        }
      }
    }
  });

  context.subscriptions.push(providerDisposable);

  const disposable = vscode.commands.registerCommand('jsonnetRenderer.renderFile', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;

    if (!filePath.endsWith('.jsonnet') && !filePath.endsWith('.libsonnet')) {
      vscode.window.showErrorMessage('Not a Jsonnet/libsonnet file.');
      return;
    }

    try {
      const yamlOutput = await utils.renderJsonnetToYaml(filePath);

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

  const livePreviewDisposable = vscode.commands.registerCommand('jsonnetRenderer.livePreview', async (uri: vscode.Uri) => {
    const filePath = uri.fsPath;

    if (!filePath.endsWith('.jsonnet') && !filePath.endsWith('.libsonnet')) {
      vscode.window.showErrorMessage('Not a Jsonnet/libsonnet file.');
      return;
    }

    let session = previewSessions.get(filePath);
    if (!session) {
      const sanitized = filePath.replace(/[^a-z0-9]/gi, '_');
      const virtualUri = vscode.Uri.parse(`rendered:live_${sanitized}.yaml`);
      let deps = await utils.collectJsonnetDependencies(filePath);
      const watcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.uri.fsPath === filePath || deps.has(doc.uri.fsPath)) {
          try {
            deps = await utils.collectJsonnetDependencies(filePath);
            const yaml = await utils.renderJsonnetToYaml(filePath);
            virtualDocs.set(virtualUri.toString(), yaml);
            changeEmitter.fire(virtualUri);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Render failed: ${err.message}`);
          }
        }
      });
      context.subscriptions.push(watcher);
      session = { virtualUri, watcher };
      previewSessions.set(filePath, session);
    }

    try {
      const yamlOutput = await utils.renderJsonnetToYaml(filePath);
      virtualDocs.set(session.virtualUri.toString(), yamlOutput);
      const doc = await vscode.workspace.openTextDocument(session.virtualUri);
      vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Render failed: ${err.message}`);
    }
  });

  context.subscriptions.push(compareDisposable);
  context.subscriptions.push(livePreviewDisposable);
  context.subscriptions.push(disposable);
}

export function deactivate() { }
