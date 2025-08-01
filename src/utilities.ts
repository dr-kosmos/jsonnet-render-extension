
import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export function execCommand(command: string, args: string[] = [], input?: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn(command, args, { cwd });

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


export async function checkCommandAvailable(command: string): Promise<boolean> {
try {
    await execCommand(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export function getLocalTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');

  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `${date}_${time}`;
}

export async function convertToYaml(doc: string): Promise<string> {
  return await execCommand('yq', ['-P'], JSON.stringify(doc));
}

export async function renderJsonnetToYaml(filePath: string): Promise<string> {
  const jsonOutput = await execCommand('jsonnet', [filePath]);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonOutput);
  } catch (err) {
    throw new Error('Failed to parse JSON output from jsonnet.');
  }

  let documents: any[] = [];
  if (Array.isArray(parsed)) {
    documents = parsed;
  } else if (parsed.items && Array.isArray(parsed.items)) {
    documents = parsed.items;
  } else {
    documents = [parsed];
  }

  let yamlOutput = '';
  for (let i = 0; i < documents.length; i++) {
    const yaml = await convertToYaml(documents[i]);
    yamlOutput += yaml;
    if (i < documents.length - 1) {
      yamlOutput += '\n---\n';
    }
  }

  return yamlOutput;
}

export async function collectJsonnetDependencies(filePath: string, seen: Set<string> = new Set()): Promise<Set<string>> {
  if (seen.has(filePath)) {
    return seen;
  }
  seen.add(filePath);

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return seen;
  }

  const dir = path.dirname(filePath);
  const regex = /\bimport(?:str|bin)?(?:\s*\(\s*)?["']([^"']+)["']\s*\)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const rel = match[1];
    const dep = path.resolve(dir, rel);
    await collectJsonnetDependencies(dep, seen);
  }
  return seen;
}
