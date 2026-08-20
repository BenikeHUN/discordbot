# discord-yt-bot

A Discord music bot that plays audio from YouTube, SoundCloud, Spotify links
and anything else yt-dlp can reach. Text commands with a `.` prefix, plus the
same commands as slash commands. No database, and no API keys unless you want
Spotify links.

## Requirements

- Node.js 18.17 or newer (tested on 24)
- A Discord application with a bot user

Nothing has to compile. The only native module, `@discordjs/opus`, is an
optional dependency: where it installs it is used for the faster Opus encoding,
and where it cannot, the pure JavaScript `opusscript` takes over and everything
keeps working. No Python is needed either.

`npm install` fetches both binaries it needs. ffmpeg comes from `ffmpeg-static`,
and `scripts/setup-ytdlp.js` downloads the self contained yt-dlp build matching
your platform and libc into `bin/`, straight from the nightly channel.

Nightly rather than stable is not a preference: the stable release trails
YouTube's player changes by weeks, and the current stable returns HTTP 403 on
every download. The self contained build rather than a wrapper package is not a
preference either, since the common wrappers install the Python zipapp, which
refuses to install without python3 and refuses to run without it.

If you would rather use your own copies, point `YTDLP_PATH` and `FFMPEG_PATH`
at them. On start the bot probes each candidate and picks the first that
actually runs, so a binary that exists but cannot execute on this host is
skipped rather than used.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Create the bot at https://discord.com/developers/applications.
   Under Bot, click Reset Token and copy it. On the same page, under Privileged
   Gateway Intents, switch on **Message Content Intent**. Without it Discord
   refuses the login, because `.play` and friends cannot read message text.

3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`.
   `PREFIX` is `.` by default, change it if it clashes with another bot.
   `GUILD_ID` only affects slash commands: set it to your server so they appear
   immediately, leave it empty to register globally (up to an hour to show up).

4. Invite the bot. The bot prints a ready made invite link to the console
   every time it starts, with exactly the permissions it needs and nothing
   more, so the simplest route is to start it first and open that link. To
   build one by hand instead, use OAuth2 > URL Generator with the `bot` and
   `applications.commands` scopes and permissions integer `3230720`.

5. Start the bot:

   ```
   npm start
   ```

   Text commands work as soon as it is online. If you also want the slash
   command versions, run `npm run deploy` once, and again whenever you add or
   change a command.

## Commands

Every command works both as `.name` and as `/name`.

| Command | Aliases | What it does |
| --- | --- | --- |
| `.summon` | `.join`, `.j` | Join your voice channel without queueing anything. Moves the bot if it is already elsewhere in the server, keeping playback running. |
| `.play <query>` | `.p` | Play a link or search by name. Searches YouTube by default; start the query with `sc:` to search SoundCloud instead. As a slash command it also autocompletes the top 5 results while you type. |
| `.skip` | `.s`, `.next` | Skip the current track |
| `.stop` | | Stop playback and clear the queue |
| `.pause` | | Pause playback |
| `.resume` | `.unpause` | Continue playback |
| `.queue [page]` | `.q` | List the queue, 10 tracks per page |
| `.nowplaying` | `.np` | Current track with a progress bar |
| `.loop <off\|track\|queue>` | `.repeat` | Repeat one track or the whole queue |
| `.volume [percent]` | `.vol`, `.v` | Show the volume, or set it between 0 and 200. Eases across rather than jumping, works while a track plays and while nothing does, and the level sticks for everything queued afterwards. |
| `.shuffle` | | Randomise the queue order |
| `.remove <position>` | `.rm` | Drop one track from the queue |
| `.leave` | `.dc`, `.disconnect` | Disconnect from voice |
| `.help` | `.h`, `.commands` | List everything above |

The bot leaves on its own after `LEAVE_TIMEOUT` seconds (120 by default) once
the queue runs out or everyone leaves the voice channel. Set it to 0 to stay.

## Docker

```
cp .env.example .env      # fill in DISCORD_TOKEN and CLIENT_ID
docker compose up -d --build
```

The image is Debian based. The build stage carries a C++ toolchain so the
optional opus module can compile if no prebuild matches your Node version; the
runtime stage does not, and only carries `node_modules`, `bin/` and the source.

`UPDATE_YTDLP_ON_START` is on in the compose file, so every start pulls the
current yt-dlp nightly. That means a `docker compose restart` is usually enough
when YouTube breaks playback, without rebuilding the image. Set it to `false`
if you want startups to be reproducible instead.

`init: true` matters here: node spawns yt-dlp and ffmpeg per track, and without
an init process those would pile up as zombies.

Logs and shutdown:

```
docker compose logs -f
docker compose down
```

To use cookies, put `cookies.txt` next to the compose file, uncomment the
`volumes` block, and set `YTDLP_COOKIES=/app/cookies.txt` in `.env`.

## Pterodactyl

Import `egg-discord-music-bot.json` in the panel under Admin, Nests, Import
Egg, then create a server from it.

The egg is built around what those containers actually are, and three details
matter if you edit it:

- The startup command has to stay a single command. The yolks entrypoint runs
  it through `exec env` with no shell, so `if`, `;` and the rest are syntax
  errors. Everything that has to happen before the bot starts lives in
  `scripts/start.sh` instead.
- The installation container has to run as root. The yolks runtime images
  default to the `container` user, which cannot even read the install script
  Wings writes, so the install step uses a plain `node` image.
- That node image has to match the runtime image's Debian release. The native
  Opus encoder is resolved by glibc version, so a build produced on a different
  release will not load, and playback quietly drops to the slower pure
  JavaScript encoder.

Two ways to get the code in:

- Set the **Git repository** variable and the install step clones it. Reinstall
  the server to pull a newer version.
- Leave it empty, upload `package.json`, `src/` and `scripts/` through the file
  manager, then run the install. Anything already there is kept.

Fill in the **Bot token** variable and start the server. The console prints the
invite link. Prefix commands work right away; flip **Register slash commands**
to `1` if you also want the slash versions, and set the server ID variable so
they show up immediately.

Startup reinstalls dependencies only when `node_modules` is missing, so normal
restarts are fast. Give the server at least 512 MB: node plus one ffmpeg and
one yt-dlp per playing guild.

When YouTube breaks playback, reinstall the server, or open the console and run
`npm run setup-ytdlp`.

## Where the audio comes from

**YouTube and SoundCloud** are both native: yt-dlp downloads the real audio.
Links to a single track, a YouTube playlist or a SoundCloud set all work, and
`.play sc: <terms>` searches SoundCloud instead of YouTube.

Anything else yt-dlp supports also plays if you paste a link to it, Bandcamp
and direct audio URLs included. Nothing in the bot is YouTube specific beyond
the default search.

**Spotify is a bridge, not a source.** Spotify does not allow third parties to
stream its audio; the Web API only exposes 30 second previews. So a Spotify
link is read for metadata, and the audio comes from the matching YouTube
video. Convenient for pasting a playlist your friends already share, but the
sound quality and the match are YouTube's, not Spotify's.

It is off unless you set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in
`.env` (a free app at https://developer.spotify.com/dashboard gives you both).
Without them the bot just tells the user Spotify is not configured.

The YouTube lookup for a Spotify track happens when the track is about to
play, not when it is queued, so pasting a 200 track playlist costs one API call
rather than 200 searches.

## How playback works

`src/youtube.js` spawns yt-dlp to read track metadata as JSON, and for playback
pipes `yt-dlp -o -` into `ffmpeg -f s16le pipe:1`. yt-dlp picks the extractor
from the URL, which is why SoundCloud and the rest need no extra code. The raw 48 kHz stereo PCM
goes to `@discordjs/voice` as `StreamType.Raw` with `inlineVolume`, which scales
the samples and encodes them to Opus at 96 kbps.

Volume changes move gradually rather than in one step, and a track set above
`FADE_IN_FROM` opens at that level and eases up to the full one, so a loud
setting does not burst in on whoever is listening. Both movements step along
the logarithmic scale rather than the raw gain, since the ear does not hear
gain linearly, and both are driven by elapsed time so timer drift affects how
smooth they are but never how long they take.

PCM rather than letting ffmpeg emit Opus directly, because volume has to be
adjustable while a track is playing, and that means touching the samples before
they are encoded. Encoding uses `@discordjs/opus` when it is available and
`opusscript` when it is not, so no host is locked out by a missing toolchain.
`@noble/ciphers` provides the voice encryption in pure JavaScript.

## Troubleshooting

**"Sign in to confirm you are not a bot" or age restricted videos.** YouTube
sometimes challenges datacenter IPs. Export your cookies to a Netscape-format
`cookies.txt` and set `YTDLP_COOKIES` to its path. Use a throwaway account.

**"Failed to extract entry" or "failed to map segment from shared object"
from yt-dlp.** It is a PyInstaller bundle that unpacks itself on every run,
and it ran out of room doing so. Panels usually mount a small tmpfs on `/tmp`,
often 100 MB, which is less than the bundle needs, and two tracks starting at
once need it twice over. The bot points yt-dlp at `tmp/` beside the code
instead, so this should not come up; if it does, check that the server has
free disk quota there.

**HTTP 403, "Requested format is not available", or playback that used to
work and now does not.** yt-dlp has fallen behind YouTube's player again. Pull
the newest nightly:

```
npm run setup-ytdlp
```

This is the first thing to try for any playback failure. If it is still broken
afterwards, the video itself needs cookies (see above).

**The bot ignores `.play`.** Either the Message Content intent is off in the
Developer Portal, or the bot cannot read that channel. The console prints a
clear error for the intent case and the process exits.

**Slash commands do not show up.** `npm run deploy` has to run once, and the
invite link needs the `applications.commands` scope. With `GUILD_ID` unset the
commands are global and take up to an hour. The `.` commands do not need any of
this.

**The bot joins but no sound.** Check that it has Speak permission in that
channel, that it is not server muted, and that `.volume` is not at 0.

**Sound is distorted.** Volume above 100 amplifies the signal and loud sources
clip. Drop back to 100, or lower `MAX_VOLUME` in `.env` to keep users from
going above it.

## Layout

```
bin/                  yt-dlp, downloaded for this platform by npm install
tmp/                  scratch space yt-dlp unpacks itself into
src/
  index.js            client, prefix and slash routing, auto leave
  config.js           .env parsing, binary probing
  context.js          adapter that makes one command serve both entry points
  deploy-commands.js  slash command registration
  load-commands.js    command and alias registry
  player.js           per guild queue, voice connection, playback state
  youtube.js          yt-dlp metadata and the yt-dlp to ffmpeg stream
  spotify.js          Spotify metadata, bridged to a YouTube search
  guards.js           shared permission and state checks
  format.js           embeds, durations, progress bar
  commands/           one file per command
```

A command file exports `data` (a `SlashCommandBuilder`), `execute(ctx)`, and
optionally `aliases` and `usage`. It never touches the raw interaction or
message: `ctx.getString()`, `ctx.getInteger()`, `ctx.defer()` and `ctx.reply()`
behave the same either way, so one file covers both `.play` and `/play`. For
prefixed messages the words after the command name are mapped onto the slash
options in order, with the last string option taking the rest of the line.
