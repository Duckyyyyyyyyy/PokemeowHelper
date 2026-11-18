/**
 * Zips the built extension (dist/) into release/MeowHelper-<version>.zip to send to friends.
 * Run `npm run package` (it builds first). The zip is ignored by git.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'manifest.json'))) throw new Error('dist/ is missing – run `npm run build` first.');

const { version } = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outDir = resolve(root, 'release');
mkdirSync(outDir, { recursive: true });
const zip = resolve(outDir, `MeowHelper-${version}.zip`);
rmSync(zip, { force: true });

if (process.platform === 'win32' || process.platform === 'darwin') {
  // bsdtar (built into Windows 10+ and macOS) writes a standard zip with "/" paths.
  // (PowerShell 5's Compress-Archive writes "\" paths, which break on Mac/Linux.)
  // Relative output path: a "D:\" path would be read as a remote host by GNU tar.
  const tar = process.platform === 'win32' ? resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-a', '-cf', relative(dist, zip), ...readdirSync(dist)], { cwd: dist, stdio: 'inherit' });
} else {
  execFileSync('zip', ['-rq', zip, '.'], { cwd: dist, stdio: 'inherit' });
}
console.log(`Packed ${zip}`);
