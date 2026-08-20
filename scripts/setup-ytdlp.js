// Two jobs, both about yt-dlp being usable at all:
//
// 1. youtube-dl-exec downloads the Python zipapp build on Linux, which needs a
//    python3 that plenty of hosts do not have. If nothing runnable is found,
//    the matching self contained build is fetched instead.
// 2. The stable release trails YouTube's player changes by weeks, so whatever
//    binary is in place gets moved to the nightly channel.
import { spawn } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bundledYtDlp, firstWorking, ytDlpCandidates } from '../src/config.js';

const NIGHTLY = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download';

function assetName() {
  const arm = process.arch === 'arm64';

  if (process.platform === 'win32') return arm ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';

  if (process.platform === 'linux') {
    // glibcVersionRuntime is absent on musl based distributions such as Alpine.
    const glibc = process.report?.getReport()?.header?.glibcVersionRuntime;
    const musl = !glibc || existsSync('/lib/ld-musl-x86_64.so.1') || existsSync('/lib/ld-musl-aarch64.so.1');
    if (musl) return arm ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_musllinux';
    return arm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  }

  return null;
}

async function download() {
  const asset = assetName();
  if (!asset) {
    console.warn(`No yt-dlp build published for ${process.platform}/${process.arch}. Set YTDLP_PATH yourself.`);
    return null;
  }

  const url = `${NIGHTLY}/${asset}`;
  console.log(`Downloading yt-dlp (${asset}) for ${process.platform}/${process.arch}`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed with ${response.status}`);

  await mkdir(path.dirname(bundledYtDlp), { recursive: true });
  await writeFile(bundledYtDlp, Buffer.from(await response.arrayBuffer()));
  if (process.platform !== 'win32') await chmod(bundledYtDlp, 0o755);

  console.log(`yt-dlp ready at ${bundledYtDlp}`);
  return bundledYtDlp;
}

function run(binary, args) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

let binary = await firstWorking(ytDlpCandidates());

if (!binary) {
  console.log('No yt-dlp present yet, setting one up.');
  try {
    binary = await download();
  } catch (error) {
    console.warn(`Could not download yt-dlp: ${error.message}`);
  }
}

if (!binary) {
  console.warn('yt-dlp is still missing. Playback will not work until it is available.');
  process.exit(0);
}

if (!(await run(binary, ['--update-to', 'nightly']))) {
  console.warn('Could not move yt-dlp to the nightly channel. Playback may still work.');
}

process.exit(0);
