
import * as cp from 'child_process';

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
