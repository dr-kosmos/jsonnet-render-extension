import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

function execCommand(command: string, args: string[] = [], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(command, args);
    let stdout = '';
    let stderr = '';

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }

    proc.stdout.on('data', (data) => (stdout += data.toString()));
    proc.stderr.on('data', (data) => (stderr += data.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `Process exited with code ${code}`));
      }
    });
  });
}

async function checkCommandAvailable(command: string): Promise<boolean> {
  try {
    await execCommand(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

function getLocalTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `${date}_${time}`;
}

export async function activate(context: vscode.ExtensionContext) {
  const commandsToCheck = ['jsonnet', 'jq', 'yq'];
  const missing: string[] = [];

  for (const cmd of commandsToCheck) {
    const ok = await checkCommandAvailable(cmd);
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
      const jsonOutput = await execCommand('jsonnet', [filePath]);

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
        const yaml = await execCommand('yq', ['-P'], JSON.stringify(doc));
        if (first === false){
          yamlOutput += `${yaml}\n---\n`;
        }
        else{
          first = false;
        }
      }

      const originalName = path.basename(filePath, path.extname(filePath));
      const timestamp = getLocalTimestamp();
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

  context.subscriptions.push(disposable);
}

export function deactivate() {}
