import {
    type ApplicationCommandOptionChoiceData,
    type ChatInputCommandInteraction,
    InteractionContextType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
    type SlashCommandStringOption,
} from "discord.js";
import { type CharacterName, characterSlug, parseCharacterName } from "../blizzard/names.ts";
import type { CharacterSummary } from "../blizzard/service.ts";
import type { Claim } from "../claims/store.ts";
import { mapLimit } from "../util/cache.ts";
import { claimsListEmbed, whoEmbed } from "../views/claims.ts";
import { BAD_NAME, notFoundMessage, rosterChoices } from "./character.ts";
import type { BotContext, Command } from "./types.ts";

/** How many characters one member can have. Keeps `/who` to a handful of API requests. */
export const MAX_CLAIMS = 20;

/** Replies mention members to name them, without pinging them. */
const NO_PINGS = { parse: [] };

const nameOption = (option: SlashCommandStringOption) =>
    option.setName("name").setDescription("Firstname Lastname").setRequired(true).setAutocomplete(true);

const bold = (character: Pick<Claim, "name" | "surname">) => `**${character.name} ${character.surname}**`;

async function refuse(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    const message = { content, allowedMentions: NO_PINGS };
    if (interaction.deferred) await interaction.editReply(message);
    else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
}

/** The server and character a command is about. Replies and returns undefined when either is missing. */
async function target(
    interaction: ChatInputCommandInteraction,
): Promise<{ serverId: string; input: string; who: CharacterName } | undefined> {
    const input = interaction.options.getString("name", true).trim();
    const who = parseCharacterName(input);
    if (!interaction.guildId) await refuse(interaction, "This only works in a server.");
    else if (!who) await refuse(interaction, BAD_NAME);
    else return { serverId: interaction.guildId, input, who };
    return undefined;
}

/**
 * Gives a character to a member, after checking with the API that it exists. Members can only take unclaimed
 * characters; `assignedBy` (an admin) can move one from whoever has it.
 */
async function give(
    interaction: ChatInputCommandInteraction,
    ctx: BotContext,
    userId: string,
    assignedBy?: string,
): Promise<void> {
    const found = await target(interaction);
    if (!found) return;
    const { serverId, input, who } = found;
    const own = userId === interaction.user.id;

    const blocked = (slug: string): string | undefined => {
        const current = ctx.claims.owner(serverId, slug);
        if (current?.userId === userId) return own ? `You've already claimed ${bold(current)}.` : `${bold(current)} already belongs to <@${userId}>.`;
        if (current && !assignedBy) return `${bold(current)} is already claimed by <@${current.userId}>.`;
        if (ctx.claims.forUser(serverId, userId).length >= MAX_CLAIMS) {
            return `${own ? "You already have" : `<@${userId}> already has`} the maximum of ${MAX_CLAIMS} characters.`;
        }
        return undefined;
    };
    // Checked before the API request to answer at once, and again after it in case the claim changed meanwhile.
    const early = blocked(characterSlug(who));
    if (early) return refuse(interaction, early);

    await interaction.deferReply();
    const character = await ctx.forever.summarize(who, ctx.config.defaultGuild);
    if (!character) return refuse(interaction, notFoundMessage(input, ctx.config.blizzard.region));
    const late = blocked(character.slug);
    if (late) return refuse(interaction, late);

    const { name, surname, slug } = character;
    const previous = await ctx.claims.set(serverId, { slug, name, surname, userId, claimedAt: Date.now(), assignedBy });
    const content = !assignedBy
        ? `${bold(character)} is now claimed by <@${userId}>.`
        : previous
          ? `${bold(character)} moved from <@${previous.userId}> to <@${userId}>.`
          : `${bold(character)} is now assigned to <@${userId}>.`;
    await interaction.editReply({ content, allowedMentions: NO_PINGS });
}

function claimChoices(claims: readonly Claim[], typed: string): ApplicationCommandOptionChoiceData[] {
    const needle = typed.trim().toLowerCase();
    return claims
        .map((claim) => `${claim.name} ${claim.surname}`)
        .filter((name) => name.toLowerCase().includes(needle))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25)
        .map((name) => ({ name, value: name }));
}

export const claim: Command = {
    data: new SlashCommandBuilder()
        .setName("claim")
        .setDescription("Claim one of your characters, so others can see who plays it")
        .setContexts(InteractionContextType.Guild)
        .addStringOption(nameOption),

    async execute(interaction, ctx) {
        await give(interaction, ctx, interaction.user.id);
    },

    /** Suggests guild members nobody has claimed yet. */
    async autocomplete(interaction, ctx) {
        const serverId = interaction.guildId;
        return rosterChoices(ctx, interaction.options.getFocused(), (slug) => !serverId || !ctx.claims.owner(serverId, slug));
    },
};

export const unclaim: Command = {
    data: new SlashCommandBuilder()
        .setName("unclaim")
        .setDescription("Release a character you claimed")
        .setContexts(InteractionContextType.Guild)
        .addStringOption(nameOption),

    async execute(interaction, ctx) {
        const found = await target(interaction);
        if (!found) return;
        const current = ctx.claims.owner(found.serverId, characterSlug(found.who));
        if (current?.userId !== interaction.user.id) return refuse(interaction, `You haven't claimed **${found.input}**.`);
        await ctx.claims.remove(found.serverId, current.slug);
        await interaction.reply({ content: `${bold(current)} is no longer claimed.`, allowedMentions: NO_PINGS });
    },

    async autocomplete(interaction, ctx) {
        if (!interaction.guildId) return [];
        return claimChoices(ctx.claims.forUser(interaction.guildId, interaction.user.id), interaction.options.getFocused());
    },
};

export const who: Command = {
    data: new SlashCommandBuilder()
        .setName("who")
        .setDescription("Show a server member's characters")
        .setContexts(InteractionContextType.Guild)
        .addUserOption((option) => option.setName("member").setDescription("The member (default: you)")),

    async execute(interaction, ctx) {
        if (!interaction.guildId) return refuse(interaction, "This only works in a server.");
        const user = interaction.options.getUser("member") ?? interaction.user;
        await interaction.deferReply();
        const claims = ctx.claims.forUser(interaction.guildId, user.id);
        // A character the API can't describe right now is still listed, by the name it was claimed under.
        const characters = await mapLimit(claims, 5, async (entry): Promise<CharacterSummary> => {
            const known = await ctx.forever.summarize(entry, ctx.config.defaultGuild).catch(() => undefined);
            return known ?? { name: entry.name, surname: entry.surname, slug: entry.slug };
        });
        const member = { id: user.id, displayName: user.displayName, avatarUrl: user.displayAvatarURL() };
        await interaction.editReply({ embeds: [whoEmbed(member, characters)], allowedMentions: NO_PINGS });
    },
};

export const claims: Command = {
    data: new SlashCommandBuilder()
        .setName("claims")
        .setDescription("Manage which member plays which character")
        .setContexts(InteractionContextType.Guild)
        // Admin only by default. A server can open it to other roles under Server Settings → Integrations.
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
            sub
                .setName("assign")
                .setDescription("Give a character to a member, taking it from whoever has it")
                .addUserOption((option) => option.setName("member").setDescription("The member who plays it").setRequired(true))
                .addStringOption(nameOption),
        )
        .addSubcommand((sub) =>
            sub.setName("unassign").setDescription("Remove a character from the member who has it").addStringOption(nameOption),
        )
        .addSubcommand((sub) => sub.setName("list").setDescription("List every claimed character in this server")),

    async execute(interaction, ctx) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "assign") {
            await give(interaction, ctx, interaction.options.getUser("member", true).id, interaction.user.id);
            return;
        }
        if (subcommand === "list") {
            if (!interaction.guildId) return refuse(interaction, "This only works in a server.");
            await interaction.reply({ embeds: [claimsListEmbed(ctx.claims.all(interaction.guildId))], allowedMentions: NO_PINGS });
            return;
        }

        const found = await target(interaction);
        if (!found) return;
        const removed = await ctx.claims.remove(found.serverId, characterSlug(found.who));
        if (!removed) return refuse(interaction, `**${found.input}** isn't claimed.`);
        await interaction.reply({
            content: `${bold(removed)} is no longer assigned to <@${removed.userId}>.`,
            allowedMentions: NO_PINGS,
        });
    },

    async autocomplete(interaction, ctx) {
        const typed = interaction.options.getFocused();
        if (interaction.options.getSubcommand(false) === "assign") return rosterChoices(ctx, typed);
        return interaction.guildId ? claimChoices(ctx.claims.all(interaction.guildId), typed) : [];
    },
};
