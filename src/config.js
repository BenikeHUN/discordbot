import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the yt-dlp binary this project manages itself lives. Kept outside
 * node_modules so npm operations cannot wipe it, and fetched by
 * scripts/setup-ytdlp.js rather than by a wrapper package, because the popular
 * wrappers install the Python zipapp build and hard fail without python3.
 */
export const bundledYtDlp = path.join(
  projectRoot,
  'bin',
  process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
);

function ffmpegStaticPath() {
  try {
    return require('ffmpeg-static') || null;
  } catch {
    return null;
  }
}

/**
 * Candidates in order of preference. Existing on disk is not enough, since a
 * glibc build sitting in a musl container runs into a missing loader, so these
 * get probed before one is picked.
 */
export function ytDlpCandidates() {
  return [process.env.YTDLP_PATH, existsSync(bundledYtDlp) ? bundledYtDlp : null, 'yt-dlp']
    .filter(Boolean);
}

export function ffmpegCandidates() {
  const bundled = ffmpegStaticPath();
  return [process.env.FFMPEG_PATH, bundled && existsSync(bundled) ? bundled : null, 'ffmpeg']
    .filter(Boolean);
}

/** Resolves true when the binary exists and actually runs on this system. */
export function probeBinary(binary, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 20_000);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export async function firstWorking(candidates, args) {
  for (const candidate of candidates) {
    // Deliberately sequential: the first that runs wins, no point racing.
    // eslint-disable-next-line no-await-in-loop
    if (await probeBinary(candidate, args)) return candidate;
  }
  return null;
}

function clampVolume(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 1000);
}

export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  deployCommands: /^(1|true|yes)$/i.test(process.env.DEPLOY_COMMANDS ?? ''),
  prefix: process.env.PREFIX || '.',
  ytDlpPath: ytDlpCandidates()[0] ?? 'yt-dlp',
  ffmpegPath: ffmpegCandidates()[0] ?? 'ffmpeg',
  cookiesPath: process.env.YTDLP_COOKIES || null,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || null,
  leaveTimeout: Number.parseInt(process.env.LEAVE_TIMEOUT ?? '120', 10) * 1000,
  maxQueueSize: 500,
  defaultVolume: clampVolume(process.env.DEFAULT_VOLUME, 100),
  maxVolume: clampVolume(process.env.MAX_VOLUME, 200),
  volumeRampMs: Math.min(Math.max(Number.parseInt(process.env.VOLUME_RAMP_MS ?? '500', 10) || 0, 0), 10_000),
};

/**
 * Picks binaries that run here rather than ones that merely exist. Panels like
 * Pterodactyl hand out Alpine containers where the bundled glibc builds are
 * present but unusable, while a working ffmpeg sits on the PATH.
 */
export async function resolveBinaries() {
  const [ytDlp, ffmpeg] = await Promise.all([
    firstWorking(ytDlpCandidates()),
    firstWorking(ffmpegCandidates(), ['-version']),
  ]);

  if (!ytDlp) {
    throw new Error(
      'No working yt-dlp found. Run "npm run setup-ytdlp" to fetch one, '
      + 'or set YTDLP_PATH to a copy that runs on this system.',
    );
  }
  if (!ffmpeg) {
    throw new Error(
      'No working ffmpeg found. Install ffmpeg, or set FFMPEG_PATH to a copy '
      + 'that runs on this system.',
    );
  }

  config.ytDlpPath = ytDlp;
  config.ffmpegPath = ffmpeg;
  return { ytDlp, ffmpeg };
}

export function assertConfig({ needsClientId = false } = {}) {
  if (!config.token) throw new Error('DISCORD_TOKEN is missing from .env');
  if (needsClientId && !config.clientId) throw new Error('CLIENT_ID is missing from .env');
}
