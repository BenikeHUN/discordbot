import { MessageFlags } from 'discord.js';

/**
 * Commands are written against this shape so the same file can serve both a
 * slash command and a prefixed message command.
 */
class CommandContext {
  constructor({ guild, member, channel, user }) {
    this.guild = guild;
    this.member = member;
    this.channel = channel;
    this.user = user;
  }

  getString() { throw new Error('not implemented'); }
  getInteger() { throw new Error('not implemented'); }
  async defer() {}
  async reply() { throw new Error('not implemented'); }
  async fail(payload) { return this.reply(payload); }

  /** The message this command produced, once it has one. */
  async sentMessage() { return null; }
}

export class InteractionContext extends CommandContext {
  constructor(interaction) {
    super({
      guild: interaction.guild,
      member: interaction.member,
      channel: interaction.channel,
      user: interaction.user,
    });
    this.interaction = interaction;
  }

  // A button interaction carries no options at all, and buttons reuse the same
  // command implementations, so a missing option reads as "not given".
  getString(name, required = false) {
    const value = this.interaction.options?.getString(name) ?? null;
    if (required && value === null) throw new Error(`Missing argument: ${name}`);
    return value;
  }

  getInteger(name, required = false) {
    const value = this.interaction.options?.getInteger(name) ?? null;
    if (required && value === null) throw new Error(`Missing argument: ${name}`);
    return value;
  }

  async defer() {
    if (!this.interaction.deferred && !this.interaction.replied) {
      await this.interaction.deferReply();
    }
  }

  async reply(payload) {
    if (this.interaction.deferred) return this.interaction.editReply(payload);
    if (this.interaction.replied) return this.interaction.followUp(payload);
    return this.interaction.reply(payload);
  }

  async sentMessage() {
    return this.interaction.fetchReply().catch(() => null);
  }

  async fail(payload) {
    const { interaction } = this;
    if (interaction.deferred) return interaction.editReply(payload).catch(() => {});
    const ephemeral = { ...payload, flags: MessageFlags.Ephemeral };
    if (interaction.replied) return interaction.followUp(ephemeral).catch(() => {});
    return interaction.reply(ephemeral).catch(() => {});
  }
}

export class MessageContext extends CommandContext {
  constructor(message, options) {
    super({
      guild: message.guild,
      member: message.member,
      channel: message.channel,
      user: message.author,
    });
    this.message = message;
    this.options = options;
  }

  getString(name, required = false) {
    const value = this.options[name] ?? null;
    if (required && value === null) throw new Error(`Missing argument: ${name}`);
    return value;
  }

  getInteger(name, required = false) {
    const raw = this.options[name];
    if (raw === undefined || raw === null || raw === '') {
      if (required) throw new Error(`Missing argument: ${name}`);
      return null;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) throw new Error(`${name} has to be a number.`);
    return value;
  }

  async defer() {
    await this.message.channel.sendTyping().catch(() => {});
  }

  async reply(payload) {
    if (this.sent) return this.sent.edit(payload);
    this.sent = await this.message.reply({ ...payload, allowedMentions: { repliedUser: false } });
    return this.sent;
  }

  async sentMessage() { return this.sent ?? null; }
}
