import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { GuildMember, GuildOverview } from "../blizzard/service.ts";
import { escapeMarkdown, factionColor, num, relativeTime } from "./format.ts";

export const ROSTER_PAGE_SIZE = 20;

export type RosterSort = "rank" | "level" | "name";

/** The guild's rank names. The API only gives the rank's number, where 0 is the guild master. */
const RANK_NAMES: Record<number, string> = {
    0: "Guild master",
    1: "Warchief",
    2: "Officer",
    3: "Member",
};

export function rankName(rank: number): string {
    return RANK_NAMES[rank] ?? `Rank ${rank}`;
}

export interface RosterQuery {
    page: number;
    /** 0 for every class. */
    classId: number;
    minLevel: number;
    sort: RosterSort;
}

const SORTS: Record<RosterSort, (a: GuildMember, b: GuildMember) => number> = {
    rank: (a, b) => a.rank - b.rank || b.level - a.level || a.name.localeCompare(b.name),
    level: (a, b) => b.level - a.level || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name) || a.surname.localeCompare(b.surname),
};

export function filterRoster(members: readonly GuildMember[], query: RosterQuery): GuildMember[] {
    return members
        .filter((member) => (!query.classId || member.classId === query.classId) && member.level >= query.minLevel)
        .sort(SORTS[query.sort] ?? SORTS.level);
}

function countBy<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function base({ guild }: GuildOverview): EmbedBuilder {
    return new EmbedBuilder().setColor(factionColor(guild.faction?.type)).setTitle(`<${guild.name}>`);
}

export function guildInfoEmbed(overview: GuildOverview): EmbedBuilder {
    const { guild, members } = overview;
    const embed = base(overview);
    const inline = (name: string, value: string | undefined) => {
        if (value) embed.addFields({ name, value, inline: true });
    };

    inline("Ruleset", guild.ruleset?.name);
    inline("Faction", guild.faction?.name);
    inline("Members", num(guild.member_count ?? members.length));
    if (guild.created_timestamp) inline("Founded", relativeTime(guild.created_timestamp));
    if (guild.achievement_points) inline("Achievement points", num(guild.achievement_points));

    const master = members.find((member) => member.rank === 0);
    if (master) inline("Guild master", escapeMarkdown(`${master.name} ${master.surname}`));

    if (members.length) {
        const top = Math.max(...members.map((member) => member.level));
        const average = members.reduce((sum, member) => sum + member.level, 0) / members.length;
        const atTop = members.filter((member) => member.level === top).length;
        inline("Levels", `Highest ${top} (${atTop})\nAverage ${average.toFixed(1)}`);

        const classes = countBy(members, (member) => member.className)
            .map(([name, count]) => `${name} ${count}`)
            .join(" · ");
        embed.addFields({ name: "Classes", value: classes.slice(0, 1024) });
        const races = countBy(members, (member) => member.raceName)
            .map(([name, count]) => `${name} ${count}`)
            .join(" · ");
        embed.addFields({ name: "Races", value: races.slice(0, 1024) });
    }
    return embed;
}

/** Custom ID of a roster page button. Stateless, so paging keeps working after a bot restart. */
export function rosterButtonId(slug: string, query: RosterQuery): string {
    return ["roster", query.page, query.classId, query.minLevel, query.sort, slug].join("|");
}

export function parseRosterButtonId(customId: string): { slug: string; query: RosterQuery } | undefined {
    const [kind, page, classId, minLevel, sort, ...slug] = customId.split("|");
    if (kind !== "roster" || !slug.length) return undefined;
    return {
        slug: slug.join("|"),
        query: {
            page: Number(page) || 0,
            classId: Number(classId) || 0,
            minLevel: Number(minLevel) || 0,
            sort: sort === "rank" || sort === "name" ? sort : "level",
        },
    };
}

export interface RosterMessage {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
}

export function guildRosterMessage(overview: GuildOverview, query: RosterQuery): RosterMessage {
    const matching = filterRoster(overview.members, query);
    const pages = Math.max(1, Math.ceil(matching.length / ROSTER_PAGE_SIZE));
    const page = Math.min(Math.max(0, query.page), pages - 1);
    const shown = matching.slice(page * ROSTER_PAGE_SIZE, (page + 1) * ROSTER_PAGE_SIZE);

    const lines = shown.map(
        (member) =>
            `\`${String(member.level).padStart(2)}\` **${escapeMarkdown(`${member.name} ${member.surname}`)}** — ${member.raceName} ${member.className} · ${rankName(member.rank)}`,
    );

    const filters: string[] = [];
    if (query.classId) filters.push(shown[0]?.className ?? `class ${query.classId}`);
    if (query.minLevel) filters.push(`level ${query.minLevel}+`);

    const embed = base(overview)
        .setDescription(lines.length ? lines.join("\n") : "No members match.")
        .setFooter({
            text: [
                `${num(matching.length)} of ${num(overview.members.length)} members`,
                filters.length ? filters.join(", ") : undefined,
                `sorted by ${query.sort}`,
                `page ${page + 1}/${pages}`,
            ]
                .filter(Boolean)
                .join(" · "),
        });

    if (pages <= 1) return { embeds: [embed], components: [] };
    const button = (label: string, target: number) =>
        new ButtonBuilder()
            .setCustomId(rosterButtonId(overview.guild.slug, { ...query, page: target }))
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(target < 0 || target >= pages);
    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(button("◀ Previous", page - 1), button("Next ▶", page + 1)),
        ],
    };
}
