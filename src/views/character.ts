import { EmbedBuilder } from "discord.js";
import type {
    ForeverCharacterEquipment,
    ForeverCharacterProfessions,
    ForeverCharacterProfile,
    ForeverCharacterReputations,
    ForeverCharacterSpecializations,
    ForeverCharacterStatistics,
} from "@pinta365/blizzard_api/wow-forever";
import type { CharacterOverview } from "../blizzard/service.ts";
import { classColor, escapeMarkdown, fitLines, num, percent, qualityIcon, relativeTime, truncate } from "./format.ts";

function fullName(profile: Pick<ForeverCharacterProfile, "name" | "surname">): string {
    return `${profile.name} ${profile.surname}`;
}

function base(profile: ForeverCharacterProfile, section?: string): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(classColor(profile.character_class?.id))
        .setAuthor({
            name: `${fullName(profile)} · ${profile.level} ${profile.race?.name ?? ""} ${profile.character_class?.name ?? ""}`
                .replace(/\s+/g, " ")
                .trim(),
        })
        .setTitle(section ?? fullName(profile));
}

type SpecGroup = ForeverCharacterSpecializations["specialization_groups"][number];

function activeGroup(specializations: ForeverCharacterSpecializations | undefined): SpecGroup | undefined {
    const groups = specializations?.specialization_groups ?? [];
    return groups.find((group) => group.is_active) ?? groups[0];
}

/** Talent points per tree, e.g. "Affliction 21 / Demonology 0 / Destruction 10". */
export function talentSummary(specializations: ForeverCharacterSpecializations | undefined): string | undefined {
    const trees = activeGroup(specializations)?.specializations;
    if (!trees?.length) return undefined;
    return trees.map((tree) => `${tree.specialization_name} ${tree.spent_points}`).join(" / ");
}

function professionSummary(professions: ForeverCharacterProfessions | undefined): string | undefined {
    const lines = [...(professions?.primaries ?? []), ...(professions?.secondaries ?? [])].map((entry) => {
        const tier = entry.tiers?.at(-1);
        const points = entry.skill_points ?? tier?.skill_points;
        const max = entry.max_skill_points ?? tier?.max_skill_points;
        return points !== undefined ? `${entry.profession.name} ${points}${max ? `/${max}` : ""}` : entry.profession.name;
    });
    return lines.length ? lines.join("\n") : undefined;
}

/** `playedBy` is the Discord user ID of the server member who has claimed the character, if anyone has. */
export function characterInfoEmbed(overview: CharacterOverview, playedBy?: string): EmbedBuilder {
    const { profile, avatarUrl, specializations, pvp, professions } = overview;
    const embed = base(profile).setDescription(
        `Level **${profile.level}** ${profile.race.name} ${profile.character_class.name}`,
    );
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    const inline = (name: string, value: string | undefined) => {
        if (value) embed.addFields({ name, value: truncate(value, 1024), inline: true });
    };
    inline("Ruleset", profile.ruleset?.name);
    inline("Faction", profile.faction?.name);
    inline("Guild", profile.guild ? escapeMarkdown(profile.guild.name) : "—");
    if (profile.equipped_item_level > 0) {
        inline("Item level", `${profile.equipped_item_level} equipped\n${profile.average_item_level} average`);
    }
    inline("Talents", talentSummary(specializations));
    if (pvp) inline("PvP", `Rank ${pvp.pvp_rank}\n${num(pvp.honorable_kills)} honorable kills`);
    inline("Professions", professionSummary(professions));
    if (profile.achievement_points > 0) inline("Achievement points", num(profile.achievement_points));
    if (profile.last_login_timestamp > 0) inline("Last seen", relativeTime(profile.last_login_timestamp));
    if (playedBy) inline("Played by", `<@${playedBy}>`);
    return embed;
}

export function characterRenderEmbed(profile: ForeverCharacterProfile, renderUrl: string | undefined): EmbedBuilder {
    const embed = base(profile, "Render");
    return renderUrl ? embed.setImage(renderUrl) : embed.setDescription("No render available yet.");
}

export function characterGearEmbed(profile: ForeverCharacterProfile, gear: ForeverCharacterEquipment): EmbedBuilder {
    const lines = (gear.equipped_items ?? []).map((item) => {
        const parts = [`${qualityIcon(item.quality?.type)} **${item.slot.name}** — ${escapeMarkdown(item.name)}`];
        if (item.level?.value) parts.push(`ilvl ${item.level.value}`);
        const enchant = item.enchantments?.find((entry) => entry.display_string)?.display_string;
        if (enchant) parts.push(`*${enchant.replace(/^Enchanted:\s*/i, "")}*`);
        return parts.join(" · ");
    });
    const embed = base(profile, "Equipment").setDescription(
        lines.length ? fitLines(lines, 4000) : "Nothing equipped.",
    );
    const sets = (gear.equipped_item_sets ?? [])
        .map((set) => set.display_string ?? set.item_set?.name)
        .filter((name) => name !== undefined);
    if (sets.length) embed.addFields({ name: "Sets", value: truncate(sets.join("\n"), 1024) });
    if (profile.equipped_item_level > 0) {
        embed.addFields({ name: "Item level", value: `${profile.equipped_item_level} equipped`, inline: true });
    }
    return embed;
}

export function characterStatsEmbed(profile: ForeverCharacterProfile, stats: ForeverCharacterStatistics): EmbedBuilder {
    // `effective` is the total on the character sheet; `base` is the white number before gear, buffs and debuffs.
    const primary = (label: string, stat: { base: number; effective: number } | undefined) =>
        stat ? `${label} **${num(stat.effective)}** (${num(stat.base)} base)` : undefined;
    const join = (lines: (string | undefined)[]) => lines.filter(Boolean).join("\n") || "—";

    const resistances = (
        [
            ["Arcane", stats.arcane_resistance],
            ["Fire", stats.fire_resistance],
            ["Frost", stats.frost_resistance],
            ["Holy", stats.holy_resistance],
            ["Nature", stats.nature_resistance],
            ["Shadow", stats.shadow_resistance],
        ] as const
    )
        .filter(([, stat]) => stat && stat.effective !== 0)
        .map(([label, stat]) => `${label} ${stat?.effective}`);

    const embed = base(profile, "Statistics").addFields(
        {
            name: "Vitals",
            value: join([
                `Health **${num(stats.health)}**`,
                stats.power_type ? `${stats.power_type.name} **${num(stats.power)}**` : undefined,
            ]),
            inline: true,
        },
        {
            name: "Attributes",
            value: join([
                primary("Strength", stats.strength),
                primary("Agility", stats.agility),
                primary("Stamina", stats.stamina),
                primary("Intellect", stats.intellect),
                primary("Spirit", stats.spirit),
            ]),
            inline: true,
        },
        {
            name: "Defense",
            value: join([
                stats.armor ? `Armor **${num(stats.armor.effective)}**` : undefined,
                stats.defense ? `Defense ${num(stats.defense.effective)}` : undefined,
                `Dodge ${percent(stats.dodge?.value)}`,
                `Parry ${percent(stats.parry?.value)}`,
                `Block ${percent(stats.block?.value)}`,
            ]),
            inline: true,
        },
        {
            name: "Melee",
            value: join([
                `Attack power **${num(stats.attack_power ?? 0)}**`,
                `Crit ${percent(stats.melee_crit?.value)}`,
                stats.main_hand_dps
                    ? `Main hand ${Math.round(stats.main_hand_damage_min)}–${Math.round(stats.main_hand_damage_max)} (${stats.main_hand_dps.toFixed(1)} dps)`
                    : undefined,
            ]),
            inline: true,
        },
        {
            name: "Spell",
            value: join([
                `Spell power **${num(stats.spell_power ?? 0)}**`,
                `Crit ${percent(stats.spell_crit?.value)}`,
                `Mana regen ${Math.round(stats.mana_regen ?? 0)} (${Math.round(stats.mana_regen_combat ?? 0)} in combat)`,
            ]),
            inline: true,
        },
        {
            name: "Ranged",
            value: join([`Crit ${percent(stats.ranged_crit?.value)}`]),
            inline: true,
        },
    );
    if (resistances.length) embed.addFields({ name: "Resistances", value: resistances.join(" · ") });
    return embed;
}

export function characterTalentsEmbed(
    profile: ForeverCharacterProfile,
    specializations: ForeverCharacterSpecializations,
): EmbedBuilder {
    const embed = base(profile, "Talents");
    const trees = activeGroup(specializations)?.specializations ?? [];
    if (!trees.length) return embed.setDescription("No talent points spent yet.");

    embed.setDescription(`**${talentSummary(specializations)}**`);
    for (const tree of [...trees].sort((a, b) => b.spent_points - a.spent_points)) {
        const talents = (tree.talents ?? []).map((entry) => `${entry.spell_tooltip?.spell?.name ?? entry.talent.name} ${entry.talent_rank}`);
        embed.addFields({
            name: `${tree.specialization_name} (${tree.spent_points})`,
            value: talents.length ? truncate(talents.join(", "), 1024) : "—",
        });
    }
    return embed;
}

export function characterProfessionsEmbed(
    profile: ForeverCharacterProfile,
    professions: ForeverCharacterProfessions,
): EmbedBuilder {
    const embed = base(profile, "Professions");
    const describe = (entries: ForeverCharacterProfessions["primaries"]) =>
        (entries ?? [])
            .map((entry) => {
                const head = `**${entry.profession.name}**`;
                if (entry.skill_points !== undefined) {
                    return `${head} ${entry.skill_points}${entry.max_skill_points ? `/${entry.max_skill_points}` : ""}`;
                }
                const tiers = (entry.tiers ?? []).map((tier) => {
                    const recipes = tier.known_recipes?.length;
                    return `${tier.tier.name}: ${tier.skill_points}/${tier.max_skill_points}${recipes ? ` · ${recipes} recipes` : ""}`;
                });
                return tiers.length ? `${head}\n${tiers.join("\n")}` : head;
            })
            .join("\n");

    const primaries = describe(professions.primaries);
    const secondaries = describe(professions.secondaries);
    if (!primaries && !secondaries) return embed.setDescription("No professions learned.");
    if (primaries) embed.addFields({ name: "Primary", value: truncate(primaries, 1024) });
    if (secondaries) embed.addFields({ name: "Secondary", value: truncate(secondaries, 1024) });
    return embed;
}

export function characterReputationsEmbed(
    profile: ForeverCharacterProfile,
    reputations: ForeverCharacterReputations,
): EmbedBuilder {
    const lines = [...(reputations.reputations ?? [])]
        .sort((a, b) => (b.standing?.raw ?? 0) - (a.standing?.raw ?? 0))
        .map((entry) => {
            const { standing } = entry;
            const progress = standing?.max ? ` (${num(standing.value)}/${num(standing.max)})` : "";
            return `**${escapeMarkdown(entry.faction.name)}** — ${standing?.name ?? "Unknown"}${progress}`;
        });
    return base(profile, "Reputations").setDescription(lines.length ? fitLines(lines, 4000) : "No reputations yet.");
}
