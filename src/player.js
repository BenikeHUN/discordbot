import { EventEmitter } from 'node:events';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { config } from './config.js';
import { createTrackStream, hydrateTrack, search } from './youtube.js';

export const LoopMode = {
  Off: 'off',
  Track: 'track',
  Queue: 'queue',
};

const players = new Map();

/** Emits "create" with a fresh GuildPlayer so the bot can hook up listeners. */
export const playerEvents = new EventEmitter();

export class GuildPlayer extends EventEmitter {
  constructor(guild) {
    super();
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.loop = LoopMode.Off;
    this.volume = config.defaultVolume;
    this.textChannel = null;
    this.voiceChannelId = null;
    this.connection = null;
    this.activeStream = null;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.destroyed = false;
    this.leaveTimer = null;
    this.skipping = false;
    this.starting = false;
    this.volumeRamp = null;
    // Set by /play so the interaction reply is not doubled by an announcement.
    this.suppressAnnounce = false;

    this.audioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.audioPlayer.on('error', (error) => {
      this.emit('error', error, this.current);
      this.advance();
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, (oldState) => {
      if (oldState.status === AudioPlayerStatus.Idle) return;
      this.advance();
    });
  }

  get playing() {
    return this.audioPlayer.state.status === AudioPlayerStatus.Playing;
  }

  get paused() {
    return this.audioPlayer.state.status === AudioPlayerStatus.Paused
      || this.audioPlayer.state.status === AudioPlayerStatus.AutoPaused;
  }

  /** Milliseconds elapsed in the current track. */
  get elapsed() {
    const resource = this.audioPlayer.state.resource;
    return resource ? resource.playbackDuration : 0;
  }

  async connect(voiceChannel) {
    this.clearLeaveTimer();

    if (this.connection && this.voiceChannelId === voiceChannel.id
      && this.connection.state.status === VoiceConnectionStatus.Ready) {
      return this.connection;
    }

    // For a guild that already has a connection this rejoins it on the new
    // channel and hands back the same instance, so playback survives a move.
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });

    if (connection !== this.connection) {
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          // Either a move to another channel or a real drop. Give the library
          // a moment to resume before tearing the player down.
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          this.destroy();
        }
      });

      this.connection = connection;
      connection.subscribe(this.audioPlayer);
    }

    this.voiceChannelId = voiceChannel.id;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.destroy();
      throw new Error('Could not connect to the voice channel in time.');
    }

    return connection;
  }

  enqueue(tracks) {
    const room = config.maxQueueSize - this.queue.length;
    const accepted = tracks.slice(0, Math.max(room, 0));
    this.queue.push(...accepted);
    return accepted.length;
  }

  async start() {
    if (this.current || this.starting) return;
    await this.playNext();
  }

  async playNext() {
    if (this.destroyed) return;
    this.starting = true;
    this.stopStream();

    const track = this.queue.shift();
    if (!track) {
      this.current = null;
      this.starting = false;
      this.emit('queueEnd');
      this.scheduleLeave();
      return;
    }

    this.current = track;

    // Spotify tracks arrive as metadata only. Find the audio now that the
    // track is actually starting, so a long playlist is not hundreds of
    // searches up front.
    if (!track.streamUrl) {
      try {
        const [match] = await search(track.searchQuery, 1, track.requestedBy);
        if (!match) throw new Error(`Found nothing on YouTube for "${track.searchQuery}".`);
        track.streamUrl = match.streamUrl ?? match.url;
        if (!track.duration) track.duration = match.duration;
      } catch (error) {
        this.current = null;
        this.emit('error', error, track);
        // Skip it without letting loop mode put it back in the queue.
        return this.playNext();
      }
    }

    // Flat listings can omit the title and length. Fill them in so the now
    // playing embed is right; a failure here is not worth aborting playback.
    if (track.needsMetadata) {
      await hydrateTrack(track).catch(() => {});
    }

    const handle = createTrackStream(track);
    this.activeStream = handle;

    const resource = createAudioResource(handle.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });
    this.stopVolumeRamp();
    // Set outright first so the very first samples are never at the old level,
    // then ease up once the resource is the one the player is subscribed to.
    resource.volume?.setVolumeLogarithmic(this.openingVolume() / 100);
    resource.encoder?.setBitrate(96_000);

    this.startedAt = Date.now();
    this.audioPlayer.play(resource);
    this.fadeIn(resource);
    this.starting = false;
    this.emit('trackStart', track);
  }

  advance() {
    if (this.destroyed) return;

    const finished = this.current;
    this.current = null;
    this.stopStream();

    if (finished && !this.skipping) {
      if (this.loop === LoopMode.Track) this.queue.unshift(finished);
      else if (this.loop === LoopMode.Queue) this.queue.push(finished);
    } else if (finished && this.skipping && this.loop === LoopMode.Queue) {
      this.queue.push(finished);
    }

    this.skipping = false;
    this.playNext().catch((error) => this.emit('error', error, finished));
  }

  skip() {
    if (!this.current) return false;
    this.skipping = true;
    this.audioPlayer.stop(true);
    return true;
  }

  pause() {
    if (!this.playing) return false;
    return this.audioPlayer.pause(true);
  }

  resume() {
    if (!this.paused) return false;
    return this.audioPlayer.unpause();
  }

  stop() {
    this.queue.length = 0;
    this.loop = LoopMode.Off;
    this.skipping = true;
    this.audioPlayer.stop(true);
  }

  /** Volume in percent, where 100 is the untouched signal. Applies live. */
  setVolume(percent, { ramp = true } = {}) {
    this.volume = Math.min(Math.max(Math.round(percent), 0), config.maxVolume);
    this.applyVolume(ramp);
    return this.volume;
  }

  /**
   * Level a track opens at. A loud setting is eased up to rather than dropped
   * on the listener, so a track does not burst in at full tilt.
   */
  openingVolume() {
    if (config.fadeInMs <= 0) return this.volume;
    return Math.min(config.fadeInFrom, this.volume);
  }

  /** Eases a freshly started track up to the set level, when it opened below it. */
  fadeIn(resource) {
    const control = resource.volume;
    if (!control) return;
    this.rampVolume(control, this.openingVolume() / 100, this.volume / 100, config.fadeInMs);
  }

  /** Eases the playing track to the current level instead of jumping to it. */
  applyVolume(ramp) {
    const control = this.audioPlayer.state.resource?.volume;
    if (!control) {
      this.stopVolumeRamp();
      return;
    }
    this.rampVolume(
      control,
      control.volumeLogarithmic,
      this.volume / 100,
      ramp ? config.volumeRampMs : 0,
    );
  }

  /**
   * Moves one volume control from start to target over a duration. The steps
   * follow the logarithmic scale rather than the raw gain, so the change sounds
   * evenly paced rather than rushing through the quiet end, and progress comes
   * from elapsed time so timer drift changes smoothness, never duration.
   */
  rampVolume(control, start, target, durationMs) {
    this.stopVolumeRamp();

    if (durationMs <= 0 || Math.abs(target - start) < 0.005) {
      control.setVolumeLogarithmic(target);
      return;
    }

    control.setVolumeLogarithmic(start);
    const startedAt = Date.now();

    this.volumeRamp = setInterval(() => {
      // A track change swaps the resource, and the old ramp has nothing to say
      // about the new one.
      if (this.audioPlayer.state.resource?.volume !== control) {
        this.stopVolumeRamp();
        return;
      }

      const progress = Math.min((Date.now() - startedAt) / durationMs, 1);
      control.setVolumeLogarithmic(start + (target - start) * progress);
      if (progress >= 1) this.stopVolumeRamp();
    }, 25);
  }

  stopVolumeRamp() {
    if (this.volumeRamp) {
      clearInterval(this.volumeRamp);
      this.volumeRamp = null;
    }
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    return this.queue.length;
  }

  remove(index) {
    if (index < 0 || index >= this.queue.length) return null;
    return this.queue.splice(index, 1)[0];
  }

  stopStream() {
    if (this.activeStream) {
      this.activeStream.destroy();
      this.activeStream = null;
    }
  }

  /** Starts the idle countdown. force also applies while a track is playing. */
  scheduleLeave(force = false) {
    this.clearLeaveTimer();
    if (config.leaveTimeout <= 0) return;
    this.leaveTimer = setTimeout(() => {
      if (force || (!this.current && this.queue.length === 0)) this.destroy();
    }, config.leaveTimeout);
  }

  clearLeaveTimer() {
    if (this.leaveTimer) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearLeaveTimer();
    this.stopVolumeRamp();
    this.queue.length = 0;
    this.current = null;
    this.stopStream();
    this.audioPlayer.stop(true);
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    players.delete(this.guild.id);
    this.emit('destroy');
  }
}

export function getPlayer(guild) {
  return players.get(guild.id) ?? null;
}

export function getOrCreatePlayer(guild) {
  const existing = players.get(guild.id);
  if (existing && !existing.destroyed) return existing;
  const player = new GuildPlayer(guild);
  players.set(guild.id, player);
  playerEvents.emit('create', player);
  return player;
}

export function allPlayers() {
  return [...players.values()];
}
