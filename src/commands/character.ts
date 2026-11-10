import { type ApplicationCommandOptionChoiceData, type EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { type CharacterName, characterSlug, parseCharacterName } from "../blizzard/names.ts";
import type { ForeverService } from "../blizzard/service.ts";
import {
    characterGearEmbed,
    characterInfoEmbed,
    characterProfessionsEmbed,
    characterRenderEmbed,
    characterReputationsEmbed,
    characterStatsEmbed,
    characterTalentsEmbed,
} from "../views/character.ts";
import { type BotContext, type Command, within } from "./types.ts";

const SECTIONS = {
    info: "Level, class, guild, talents and professions at a glance",
    gear: "Equipped items and enchants",
    stats: "Attributes, defenses and combat stats",
    talents: "Talent points and the talents picked",
    professions: "Profession skill levels",
    reputations: "Reputation standings",
    render: "Full-body render of the character",
} as const;

type Section = keyof typeof SECTIONS;

const data = new SlashCommandBuilder().setName("character").setDescription("Look up a WoW: Forever character");
for (const [name, description] of Object.entries(SECTIONS)) {
    data.addSubcommand((sub) =>
        sub
            .setName(name)
            .setDescription(description)
            .addStringOption((option) =>
                option
                    .setName("name")
                    .setDescription("Firstname Lastname")
                    .setRequired(true)
                    .setAutocomplete(true),
            ),
    );
}

/** Builds the embed for one section, or undefined when the API doesn't serve the character. */
export async function characterSection(
    forever: ForeverService,
    who: CharacterName,
    section: Section,
    /** Discord user ID of the server member who has claimed the character, shown on the info card. */
    playedBy?: string,
): Promise<EmbedBuilder | undefined> {
    if (section === "info") {
        const overview = await forever.overview(who);
        return overview && characterInfoEmbed(overview, playedBy);
    }

    const profile = await forever.profile(who);
    if (!profile) return undefined;
    switch (section) {
        case "gear": {
            const gear = await forever.equipment(who);
            return gear && characterGearEmbed(profile, gear);
        }
        case "stats": {
            const stats = await forever.statistics(who);
            return stats && characterStatsEmbed(profile, stats);
        }
        case "talents": {
            const specializations = await forever.specializations(who);
            return specializations && characterTalentsEmbed(profile, specializations);
        }
        case "professions": {
            const professions = await forever.professions(who);
            return professions && characterProfessionsEmbed(profile, professions);
        }
        case "reputations": {
            const reputations = await forever.reputations(who);
            return reputations && characterReputationsEmbed(profile, reputations);
        }
        case "render":
            return characterRenderEmbed(profile, await forever.renderUrl(who));
    }
}

export function notFoundMessage(input: string, region: string): string {
    return (
        `I couldn't find **${input}** in the ${region.toUpperCase()} region. ` +
        "Characters only show up from level 10, and only after logging out."
    );
}

export const BAD_NAME = "Forever characters have a first name and a surname. Try something like `Chaos Chris`.";

/**
 * Suggestions from the default guild's roster, highest level first. Any other character can still be typed in full.
 */
export async function rosterChoices(
    ctx: BotContext,
    typed: string,
    include: (slug: string) => boolean = () => true,
): Promise<ApplicationCommandOptionChoiceData[]> {
    const guildName = ctx.config.defaultGuild;
    if (!guildName) return [];
    const needle = typed.trim().toLowerCase();
    const overview = ctx.forever.cachedGuild(guildName) ?? (await within(2000, ctx.forever.guild(guildName), undefined));
    if (!overview) return [];
    return overview.members
        .filter((member) => `${member.name} ${member.surname}`.toLowerCase().includes(needle) && include(member.slug))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
        .slice(0, 25)
        .map((member) => ({
            name: `${member.name} ${member.surname} · ${member.level} ${member.className}`,
            value: `${member.name} ${member.surname}`,
        }));
}

export const character: Command = {
    data,

    async execute(interaction, ctx) {
        const input = interaction.options.getString("name", true);
        const who = parseCharacterName(input);
        if (!who) {
            await interaction.reply({ content: BAD_NAME, flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply();
        const section = interaction.options.getSubcommand() as Section;
        const owner = interaction.guildId ? ctx.claims.owner(interaction.guildId, characterSlug(who)) : undefined;
        const embed = await characterSection(ctx.forever, who, section, owner?.userId);
        await interaction.editReply(
            embed ? { embeds: [embed] } : { content: notFoundMessage(input.trim(), ctx.config.blizzard.region) },
        );
    },

    async autocomplete(interaction, ctx) {
        return rosterChoices(ctx, interaction.options.getFocused());
    },
};
