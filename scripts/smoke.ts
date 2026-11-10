/**
 * Live check against the real Blizzard API: `npm run smoke` (optionally `npm run smoke -- "First Last"`).
 * Needs BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env; no Discord token. It runs the same code the slash
 * commands run, and prints what each one would show.
 */
import type { EmbedBuilder } from "discord.js";
import { parseCharacterName } from "../src/blizzard/names.ts";
import { characterSection } from "../src/commands/character.ts";
import { ConfigError, loadConfig, loadEnvFile } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { guildInfoEmbed, guildRosterMessage } from "../src/views/guild.ts";
import { itemEmbed, priceEmbed, rulesetsEmbed } from "../src/views/items.ts";

loadEnvFile();
let ctx;
try {
    ctx = createContext(loadConfig(process.env, { requireDiscord: false }));
} catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
}
const { config, forever, auctions } = ctx;

const input = process.argv.slice(2).join(" ") || "Chaos Chris";
const who = parseCharacterName(input);
if (!who) {
    console.error(`"${input}" is not a first name and a surname.`);
    process.exit(1);
}
/** What the test character is known to be. Only checked when no other name is given. */
const expected = input === "Chaos Chris" ? { race: "Orc", class: "Warlock", ruleset: "Roleplay PvP" } : undefined;

let failures = 0;
function show(embed: EmbedBuilder) {
    const { author, title, description, fields, footer, image } = embed.toJSON();
    const lines = [author?.name, title && `# ${title}`, description, ...(fields ?? []).map((field) => `[${field.name}] ${field.value.replaceAll("\n", " | ")}`), image && `<image ${image.url}>`, footer && `(${footer.text})`];
    console.log(lines.filter(Boolean).join("\n").replace(/^/gm, "    "));
}
async function step(name: string, run: () => Promise<string | void>) {
    try {
        const note = await run();
        console.log(`PASS  ${name}${note ? ` — ${note}` : ""}\n`);
    } catch (error) {
        failures++;
        console.log(`FAIL  ${name} — ${(error as Error).message}\n`);
    }
}
function check(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

console.log(`Region ${config.blizzard.region.toUpperCase()}, character "${input}"\n`);

await step("rulesets", async () => {
    const rulesets = await forever.rulesets();
    check(rulesets.length > 0, "no rulesets returned");
    show(rulesetsEmbed(rulesets, config.blizzard.region));
});

let guildName = config.defaultGuild;
await step("character info", async () => {
    const overview = await forever.overview(who);
    check(overview, "the API returned 404: the character must be level 10+ and have logged out since");
    const { profile } = overview;
    show((await characterSection(forever, who, "info"))!);
    guildName ??= profile.guild?.name;
    if (expected) {
        check(profile.race.name === expected.race, `expected race ${expected.race}, got ${profile.race.name}`);
        check(profile.character_class.name === expected.class, `expected class ${expected.class}, got ${profile.character_class.name}`);
        check(profile.ruleset.name === expected.ruleset, `expected ruleset ${expected.ruleset}, got ${profile.ruleset.name}`);
        return `${expected.race} ${expected.class} on ${expected.ruleset}, as expected`;
    }
});

for (const section of ["gear", "stats", "talents", "professions", "reputations", "render"] as const) {
    await step(`character ${section}`, async () => {
        const embed = await characterSection(forever, who, section);
        check(embed, "the API returned 404");
        show(embed);
    });
}

await step("guild info and roster", async () => {
    if (!guildName) return "skipped: the character has no guild and DEFAULT_GUILD is not set";
    const overview = await forever.guild(guildName);
    check(overview, `guild "${guildName}" was not found`);
    show(guildInfoEmbed(overview));
    show(guildRosterMessage(overview, { page: 0, classId: 0, minLevel: 0, sort: "level" }).embeds[0]!);
    return `${overview.members.length} members`;
});

await step("item search and tooltip", async () => {
    const hits = await forever.searchItems("linen cloth");
    check(hits.length > 0, 'searching for "linen cloth" returned nothing');
    console.log(`    ${hits.slice(0, 5).map((hit) => `${hit.name} #${hit.id} (${hit.source})`).join(", ")}`);
    const info = await forever.item(hits[0]!.id);
    check(info, `item ${hits[0]!.id} could not be loaded`);
    show(itemEmbed(info));
});

await step("auction houses", async () => {
    const houses = await auctions.housesFor();
    check(houses.length > 0, "no auction houses returned");
    console.log(`    Loading ${houses.length} houses. The busy ones are about 9 MB each, so this takes a moment...`);
    const { snapshots, failed } = await auctions.load(houses);
    for (const { house, listings, items } of snapshots) console.log(`    ${house.name} #${house.id}: ${listings.toLocaleString("en-US")} listings, ${items.size.toLocaleString("en-US")} items`);
    for (const house of failed) console.log(`    ${house.name} #${house.id}: couldn't load`);
    check(snapshots.some((snapshot) => snapshot.listings > 0), "no house has any listings");
    return `${snapshots.reduce((sum, snapshot) => sum + snapshot.listings, 0).toLocaleString("en-US")} listings in total`;
});

await step("price lookup", async () => {
    const info = await forever.resolveItem("linen cloth");
    check(info, "linen cloth could not be resolved");
    const result = await auctions.prices(info.item.id, config.defaultFaction);
    show(priceEmbed(info, result));
    check(result.rows.some((row) => row.price), "no house lists the item");
});

console.log(failures ? `${failures} check(s) failed.` : "All checks passed.");
process.exit(failures ? 1 : 0);
