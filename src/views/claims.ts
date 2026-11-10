import { EmbedBuilder } from "discord.js";
import type { CharacterSummary } from "../blizzard/service.ts";
import type { Claim } from "../claims/store.ts";
import { classColor, DEFAULT_COLOR, escapeMarkdown, fitLines } from "./format.ts";

export interface MemberCard {
    id: string;
    displayName: string;
    avatarUrl?: string;
}

/** A member's characters, highest level first. `characters` are the claims with what the API knows about them. */
export function whoEmbed(member: MemberCard, characters: readonly CharacterSummary[]): EmbedBuilder {
    const sorted = [...characters].sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
    const lines = sorted.map((character) => {
        const name = `**${escapeMarkdown(`${character.name} ${character.surname}`)}**`;
        if (character.level === undefined) return name;
        const kind = [character.raceName, character.className].filter(Boolean).join(" ");
        const guild = character.guildName ? ` · ${escapeMarkdown(character.guildName)}` : "";
        return `\`${String(character.level).padStart(2)}\` ${name} — ${kind}${guild}`;
    });
    return new EmbedBuilder()
        .setColor(classColor(sorted[0]?.classId))
        .setAuthor({ name: member.displayName, iconURL: member.avatarUrl })
        .setDescription(lines.length ? fitLines(lines, 4000) : `<@${member.id}> hasn't claimed any characters.`);
}

/** Every claim in the server, grouped by member. */
export function claimsListEmbed(claims: readonly Claim[]): EmbedBuilder {
    const byUser = new Map<string, Claim[]>();
    for (const claim of claims) byUser.set(claim.userId, [...(byUser.get(claim.userId) ?? []), claim]);
    const lines = [...byUser].map(([userId, owned]) => {
        const names = owned.map((claim) => escapeMarkdown(`${claim.name} ${claim.surname}`)).sort();
        return `<@${userId}> — ${names.join(", ")}`;
    });
    return new EmbedBuilder()
        .setColor(DEFAULT_COLOR)
        .setTitle("Claimed characters")
        .setDescription(lines.length ? fitLines(lines, 4000) : "No characters have been claimed.")
        .setFooter({ text: `${claims.length} character${claims.length === 1 ? "" : "s"} · ${byUser.size} member${byUser.size === 1 ? "" : "s"}` });
}
