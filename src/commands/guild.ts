import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { guildInfoEmbed, guildRosterMessage, parseRosterButtonId, type RosterSort } from "../views/guild.ts";
import { type BotContext, type Command, within } from "./types.ts";

const guildOption = (option: import("discord.js").SlashCommandStringOption) =>
    option.setName("guild").setDescription("Guild name. Leave empty for this server's guild.");

const data = new SlashCommandBuilder()
    .setName("guild")
    .setDescription("Look up a WoW: Forever guild")
    .addSubcommand((sub) =>
        sub.setName("info").setDescription("Guild summary: members, levels and class make-up").addStringOption(guildOption),
    )
    .addSubcommand((sub) =>
        sub
            .setName("roster")
            .setDescription("List the characters in a guild")
            .addStringOption(guildOption)
            .addStringOption((option) =>
                option.setName("class").setDescription("Only show this class").setAutocomplete(true),
            )
            .addIntegerOption((option) =>
                option.setName("min_level").setDescription("Only show characters at or above this level").setMinValue(1),
            )
            .addStringOption((option) =>
                option
                    .setName("sort")
                    .setDescription("Order of the list (default: level)")
                    .addChoices(
                        { name: "Level", value: "level" },
                        { name: "Guild rank", value: "rank" },
                        { name: "Name", value: "name" },
                    ),
            ),
    );

/** Resolves the class option, which is a class ID when picked from autocomplete and a name when typed. */
async function resolveClassId(ctx: BotContext, input: string | null): Promise<number | undefined> {
    if (!input) return 0;
    if (/^\d+$/.test(input)) return Number(input);
    const wanted = input.trim().toLowerCase();
    for (const [id, name] of await ctx.forever.classNames()) {
        if (name.toLowerCase() === wanted) return id;
    }
    return undefined;
}

export const guild: Command = {
    data,

    async execute(interaction, ctx) {
        const name = interaction.options.getString("guild")?.trim() || ctx.config.defaultGuild;
        if (!name) {
            await interaction.reply({
                content: "Which guild? Pass a name, or set `DEFAULT_GUILD` in the bot's `.env` to make one the default.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();
        const overview = await ctx.forever.guild(name);
        if (!overview) {
            await interaction.editReply(
                `I couldn't find a guild called **${name}** in the ${ctx.config.blizzard.region.toUpperCase()} region.`,
            );
            return;
        }

        if (interaction.options.getSubcommand() === "info") {
            await interaction.editReply({ embeds: [guildInfoEmbed(overview)] });
            return;
        }

        const classInput = interaction.options.getString("class");
        const classId = await resolveClassId(ctx, classInput);
        if (classId === undefined) {
            await interaction.editReply(`I don't know a class called **${classInput}**.`);
            return;
        }
        await interaction.editReply(
            guildRosterMessage(overview, {
                page: 0,
                classId,
                minLevel: interaction.options.getInteger("min_level") ?? 0,
                sort: (interaction.options.getString("sort") as RosterSort | null) ?? "level",
            }),
        );
    },

    async autocomplete(interaction, ctx) {
        const typed = interaction.options.getFocused().trim().toLowerCase();
        const classes = await within(2000, ctx.forever.classNames(), new Map<number, string>());
        return [...classes]
            .filter(([, name]) => name.toLowerCase().includes(typed))
            .sort((a, b) => a[1].localeCompare(b[1]))
            .slice(0, 25)
            .map(([id, name]) => ({ name, value: String(id) }));
    },

    buttonPrefix: "roster",

    async button(interaction, ctx) {
        const parsed = parseRosterButtonId(interaction.customId);
        if (!parsed) return;
        await interaction.deferUpdate();
        const overview = await ctx.forever.guild(parsed.slug);
        if (!overview) {
            await interaction.followUp({ content: "That guild is no longer available.", flags: MessageFlags.Ephemeral });
            return;
        }
        await interaction.editReply(guildRosterMessage(overview, parsed.query));
    },
};
