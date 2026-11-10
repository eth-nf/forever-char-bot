/**
 * Runs every slash command against the fake Blizzard API, through the same router the bot uses, and checks what
 * would be sent to Discord.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { APIEmbed, Interaction } from "discord.js";
import { MAX_CLAIMS } from "../src/commands/claims.ts";
import { commands, errorMessage, handleInteraction } from "../src/commands/index.ts";
import type { BotContext } from "../src/commands/types.ts";
import { BRAWLER_GLOVES, fakeApi, fakeContext, LINEN } from "./fixtures.ts";

interface Sent {
    content?: string;
    embeds: APIEmbed[];
    buttons: { label: string; customId: string; disabled: boolean }[];
    ephemeral: boolean;
    deferred: boolean;
}

function toSent(payload: unknown, deferred: boolean): Sent {
    const message = typeof payload === "string" ? { content: payload } : (payload as Record<string, any>);
    return {
        content: message.content,
        embeds: (message.embeds ?? []).map((embed: { toJSON(): APIEmbed }) => embed.toJSON()),
        buttons: (message.components ?? []).flatMap((row: { toJSON(): { components: any[] } }) =>
            row.toJSON().components.map((button) => ({ label: button.label, customId: button.custom_id, disabled: !!button.disabled })),
        ),
        ephemeral: !!message.flags,
        deferred,
    };
}

const SERVER = "server-1";
/** The member running commands unless a test says otherwise. */
const CHRIS = "100";

const fakeUser = (id: string) => ({ id, displayName: `Member ${id}`, displayAvatarURL: () => `https://cdn.example/avatars/${id}.png` });

interface Caller {
    /** Discord user ID of the member running the command. */
    as?: string;
    /** Server the command is run in. Null for a direct message. */
    server?: string | null;
}

/**
 * Runs `/name [subcommand] options...` and returns what the bot replied. A `member` option is a Discord user ID.
 */
async function run(
    ctx: BotContext,
    name: string,
    options: Record<string, string | number> = {},
    subcommand?: string,
    caller: Caller = {},
): Promise<Sent> {
    let sent: Sent | undefined;
    const state = { deferred: false, replied: false };
    const interaction = {
        commandName: name,
        guildId: caller.server === undefined ? SERVER : caller.server,
        user: fakeUser(caller.as ?? CHRIS),
        get deferred() { return state.deferred; },
        get replied() { return state.replied; },
        isAutocomplete: () => false,
        isButton: () => false,
        isChatInputCommand: () => true,
        options: {
            getSubcommand: () => subcommand,
            getString: (key: string) => (options[key] === undefined ? null : String(options[key])),
            getInteger: (key: string) => (options[key] === undefined ? null : Number(options[key])),
            getUser: (key: string) => (options[key] === undefined ? null : fakeUser(String(options[key]))),
        },
        deferReply: async () => { state.deferred = true; },
        reply: async (payload: unknown) => { state.replied = true; sent = toSent(payload, false); },
        editReply: async (payload: unknown) => { sent = toSent(payload, state.deferred); },
    };
    await handleInteraction(interaction as unknown as Interaction, ctx);
    assert.ok(sent, `/${name} sent no reply`);
    return sent;
}

async function complete(
    ctx: BotContext,
    name: string,
    typed: string,
    subcommand?: string,
    caller: Caller = {},
): Promise<{ name: string; value: string }[]> {
    let choices: { name: string; value: string }[] | undefined;
    const interaction = {
        commandName: name,
        guildId: caller.server === undefined ? SERVER : caller.server,
        user: fakeUser(caller.as ?? CHRIS),
        isAutocomplete: () => true,
        options: { getFocused: () => typed, getSubcommand: () => subcommand ?? null },
        respond: async (list: { name: string; value: string }[]) => { choices = list; },
    };
    await handleInteraction(interaction as unknown as Interaction, ctx);
    assert.ok(choices, "autocomplete did not respond");
    return choices;
}

async function press(ctx: BotContext, customId: string): Promise<Sent> {
    let sent: Sent | undefined;
    const interaction = {
        customId,
        isAutocomplete: () => false,
        isButton: () => true,
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => { sent = toSent(payload, true); },
        followUp: async (payload: unknown) => { sent = toSent(payload, true); },
    };
    await handleInteraction(interaction as unknown as Interaction, ctx);
    assert.ok(sent, "button sent nothing");
    return sent;
}

const field = (embed: APIEmbed | undefined, name: string) => embed?.fields?.find((entry) => entry.name === name)?.value;

/** Discord rejects embeds over these limits, so every embed the tests see is checked. */
function assertWithinLimits(embed: APIEmbed) {
    assert.ok((embed.title?.length ?? 0) <= 256, "title too long");
    assert.ok((embed.description?.length ?? 0) <= 4096, "description too long");
    assert.ok((embed.fields?.length ?? 0) <= 25, "too many fields");
    for (const entry of embed.fields ?? []) {
        assert.ok(entry.name.length > 0 && entry.name.length <= 256, `field name "${entry.name}"`);
        assert.ok(entry.value.length > 0 && entry.value.length <= 1024, `field "${entry.name}" value length ${entry.value.length}`);
    }
    assert.ok((embed.footer?.text.length ?? 0) <= 2048, "footer too long");
}

test("the command definitions are valid for Discord", () => {
    const names = new Set<string>();
    for (const command of commands) {
        const json = command.data.toJSON();
        assert.match(json.name, /^[-_a-z0-9]{1,32}$/);
        assert.ok(json.description.length >= 1 && json.description.length <= 100, `/${json.name} description`);
        assert.ok(!names.has(json.name), `duplicate /${json.name}`);
        names.add(json.name);
        for (const option of json.options ?? []) {
            assert.ok(option.description.length <= 100, `/${json.name} ${option.name} description`);
            for (const sub of ("options" in option && option.options) || []) {
                assert.ok(sub.description.length <= 100, `/${json.name} ${option.name} ${sub.name} description`);
            }
        }
    }
    assert.deepEqual([...names].sort(), ["character", "claim", "claims", "guild", "item", "price", "rulesets", "unclaim", "who"]);

    // Only the management command is restricted, and to members who can manage the server.
    const restricted = commands.map((command) => command.data.toJSON()).filter((json) => json.default_member_permissions);
    assert.deepEqual(restricted.map((json) => [json.name, json.default_member_permissions]), [["claims", String(1 << 5)]]);
});

const GROM = "200";
const ADMIN = "900";

test("members claim characters, and /who lists them", async () => {
    const ctx = fakeContext();
    const empty = await run(ctx, "who");
    assert.equal(empty.embeds[0]?.description, `<@${CHRIS}> hasn't claimed any characters.`);

    const claimed = await run(ctx, "claim", { name: "chaos chris" });
    assert.equal(claimed.content, `**Chaos Chris** is now claimed by <@${CHRIS}>.`);
    assert.ok(claimed.deferred && !claimed.ephemeral);

    // Below level 10 there is no profile yet, but the character is on the guild roster.
    const lowbie = await run(ctx, "claim", { name: "GruntA Number0" });
    assert.equal(lowbie.content, `**GruntA Number0** is now claimed by <@${CHRIS}>.`);

    const mine = await run(ctx, "who");
    const [embed] = mine.embeds;
    assert.equal(embed?.author?.name, `Member ${CHRIS}`);
    assert.equal(embed?.author?.icon_url, `https://cdn.example/avatars/${CHRIS}.png`);
    assert.equal(embed?.color, 0x8788ee);
    assert.equal(
        embed?.description,
        "`24` **Chaos Chris** — Orc Warlock · Burning Legion\n` 5` **GruntA Number0** — Orc Warrior · Burning Legion",
    );
    assertWithinLimits(embed!);

    // Another member looks them up, and has none of their own.
    const looked = await run(ctx, "who", { member: CHRIS }, undefined, { as: GROM });
    assert.equal(looked.embeds[0]?.description, embed?.description);
    const theirs = await run(ctx, "who", {}, undefined, { as: GROM });
    assert.equal(theirs.embeds[0]?.description, `<@${GROM}> hasn't claimed any characters.`);

    // Claims are per server.
    const elsewhere = await run(ctx, "who", {}, undefined, { server: "server-2" });
    assert.match(elsewhere.embeds[0]?.description ?? "", /hasn't claimed any/);
});

test("/claim refuses taken, unknown and badly named characters", async () => {
    const api = fakeApi();
    const ctx = fakeContext(api);
    await run(ctx, "claim", { name: "Chaos Chris" });
    const calls = api.calls.characterProfile;

    const again = await run(ctx, "claim", { name: "Chaos Chris" });
    assert.equal(again.content, "You've already claimed **Chaos Chris**.");
    const taken = await run(ctx, "claim", { name: "chaos-chris" }, undefined, { as: GROM });
    assert.equal(taken.content, `**Chaos Chris** is already claimed by <@${CHRIS}>.`);
    assert.ok(again.ephemeral && taken.ephemeral);
    // Neither needed the API.
    assert.equal(api.calls.characterProfile, calls);

    const unknown = await run(ctx, "claim", { name: "Nobody Here" });
    assert.match(unknown.content ?? "", /couldn't find \*\*Nobody Here\*\*/);
    const bad = await run(ctx, "claim", { name: "Chaos" });
    assert.match(bad.content ?? "", /first name and a surname/);
    const direct = await run(ctx, "claim", { name: "Grom Hellscream" }, undefined, { server: null });
    assert.equal(direct.content, "This only works in a server.");
    assert.deepEqual(ctx.claims.all(SERVER).map((entry) => entry.slug), ["chaos-chris"]);
});

test("a member can hold a limited number of characters", async () => {
    const ctx = fakeContext();
    for (let index = 0; index < MAX_CLAIMS; index++) {
        const name = `Grunt${String.fromCharCode(65 + (index % 26))} Number${index}`;
        assert.match((await run(ctx, "claim", { name })).content ?? "", /is now claimed/);
    }
    const over = await run(ctx, "claim", { name: "Chaos Chris" });
    assert.equal(over.content, `You already have the maximum of ${MAX_CLAIMS} characters.`);
    const assigned = await run(ctx, "claims", { member: CHRIS, name: "Chaos Chris" }, "assign", { as: ADMIN });
    assert.equal(assigned.content, `<@${CHRIS}> already has the maximum of ${MAX_CLAIMS} characters.`);

    const list = await run(ctx, "who");
    assert.equal(list.embeds[0]?.description?.split("\n").length, MAX_CLAIMS);
    assertWithinLimits(list.embeds[0]!);
});

test("/unclaim releases only your own characters", async () => {
    const ctx = fakeContext();
    await run(ctx, "claim", { name: "Chaos Chris" });

    const notMine = await run(ctx, "unclaim", { name: "Chaos Chris" }, undefined, { as: GROM });
    assert.equal(notMine.content, "You haven't claimed **Chaos Chris**.");
    assert.ok(notMine.ephemeral);
    assert.equal(ctx.claims.owner(SERVER, "chaos-chris")?.userId, CHRIS);

    const released = await run(ctx, "unclaim", { name: "chaos chris" });
    assert.equal(released.content, "**Chaos Chris** is no longer claimed.");
    assert.equal(ctx.claims.owner(SERVER, "chaos-chris"), undefined);
    assert.equal((await run(ctx, "unclaim", { name: "Chaos Chris" })).content, "You haven't claimed **Chaos Chris**.");
});

test("admins assign, move, unassign and list characters", async () => {
    const ctx = fakeContext();
    const admin = { as: ADMIN };
    assert.equal((await run(ctx, "claims", {}, "list", admin)).embeds[0]?.description, "No characters have been claimed.");

    const assigned = await run(ctx, "claims", { member: GROM, name: "grom hellscream" }, "assign", admin);
    assert.equal(assigned.content, `**Grom Hellscream** is now assigned to <@${GROM}>.`);
    assert.deepEqual(
        [ctx.claims.owner(SERVER, "grom-hellscream")?.userId, ctx.claims.owner(SERVER, "grom-hellscream")?.assignedBy],
        [GROM, ADMIN],
    );

    // An admin can take a character a member claimed and give it to someone else.
    await run(ctx, "claim", { name: "Chaos Chris" });
    const moved = await run(ctx, "claims", { member: GROM, name: "Chaos Chris" }, "assign", admin);
    assert.equal(moved.content, `**Chaos Chris** moved from <@${CHRIS}> to <@${GROM}>.`);
    assert.equal(ctx.claims.forUser(SERVER, CHRIS).length, 0);
    const same = await run(ctx, "claims", { member: GROM, name: "Chaos Chris" }, "assign", admin);
    assert.equal(same.content, `**Chaos Chris** already belongs to <@${GROM}>.`);
    const unknown = await run(ctx, "claims", { member: GROM, name: "Nobody Here" }, "assign", admin);
    assert.match(unknown.content ?? "", /couldn't find \*\*Nobody Here\*\*/);

    await run(ctx, "claim", { name: "GruntA Number0" });
    const list = await run(ctx, "claims", {}, "list", admin);
    assert.equal(list.embeds[0]?.description, `<@${GROM}> — Chaos Chris, Grom Hellscream\n<@${CHRIS}> — GruntA Number0`);
    assert.equal(list.embeds[0]?.footer?.text, "3 characters · 2 members");
    assertWithinLimits(list.embeds[0]!);

    const removed = await run(ctx, "claims", { name: "chaos-chris" }, "unassign", admin);
    assert.equal(removed.content, `**Chaos Chris** is no longer assigned to <@${GROM}>.`);
    const none = await run(ctx, "claims", { name: "Chaos Chris" }, "unassign", admin);
    assert.equal(none.content, "**Chaos Chris** isn't claimed.");
    assert.ok(none.ephemeral);
});

test("claim suggestions fit each command", async () => {
    const ctx = fakeContext();
    await run(ctx, "claim", { name: "Chaos Chris" });
    await run(ctx, "claim", { name: "Grom Hellscream" }, undefined, { as: GROM });

    // /claim leaves out characters that are taken; an admin assigning sees them all.
    assert.deepEqual(await complete(ctx, "claim", "cha"), []);
    assert.equal((await complete(ctx, "claim", "")).some((choice) => choice.value === "Grom Hellscream"), false);
    assert.deepEqual((await complete(ctx, "claims", "cha", "assign")).map((choice) => choice.value), ["Chaos Chris"]);

    assert.deepEqual(await complete(ctx, "unclaim", ""), [{ name: "Chaos Chris", value: "Chaos Chris" }]);
    assert.deepEqual(await complete(ctx, "unclaim", "", undefined, { as: GROM }), [{ name: "Grom Hellscream", value: "Grom Hellscream" }]);
    assert.deepEqual((await complete(ctx, "claims", "", "unassign")).map((choice) => choice.value), ["Chaos Chris", "Grom Hellscream"]);
    assert.deepEqual((await complete(ctx, "claims", "grom", "unassign")).map((choice) => choice.value), ["Grom Hellscream"]);
});

test("/character info names the member who claimed the character", async () => {
    const ctx = fakeContext();
    assert.equal(field((await run(ctx, "character", { name: "Chaos Chris" }, "info")).embeds[0], "Played by"), undefined);
    await run(ctx, "claim", { name: "Chaos Chris" });
    const info = await run(ctx, "character", { name: "chaos chris" }, "info", { as: GROM });
    assert.equal(field(info.embeds[0], "Played by"), `<@${CHRIS}>`);
    const elsewhere = await run(ctx, "character", { name: "Chaos Chris" }, "info", { server: "server-2" });
    assert.equal(field(elsewhere.embeds[0], "Played by"), undefined);
});

test("/character info shows the test character", async () => {
    const reply = await run(fakeContext(), "character", { name: "Chaos Chris" }, "info");
    const [embed] = reply.embeds;
    assert.ok(reply.deferred);
    assert.equal(embed?.title, "Chaos Chris");
    assert.equal(embed?.description, "Level **24** Orc Warlock");
    assert.equal(embed?.color, 0x8788ee);
    assert.equal(field(embed, "Ruleset"), "Roleplay PvP");
    assert.equal(field(embed, "Faction"), "Horde");
    assert.equal(field(embed, "Guild"), "Burning Legion");
    assert.equal(field(embed, "Talents"), "Affliction 10 / Demonology 5 / Destruction 0");
    assert.equal(field(embed, "PvP"), "Rank 2\n37 honorable kills");
    assert.equal(field(embed, "Professions"), "Tailoring 110/150\nEnchanting 95/150\nFirst Aid 80/150");
    assert.equal(field(embed, "Last seen"), "<t:1794300000:R>");
    assert.match(embed?.thumbnail?.url ?? "", /4242-avatar\.jpg$/);
    assertWithinLimits(embed!);
});

test("/character info works before the avatar has been rendered", async () => {
    const api = fakeApi();
    api.state.mediaExists = false;
    const reply = await run(fakeContext(api), "character", { name: "chaos-chris" }, "info");
    assert.equal(reply.embeds[0]?.title, "Chaos Chris");
    assert.equal(reply.embeds[0]?.thumbnail, undefined);
});

test("every /character section renders", async () => {
    const ctx = fakeContext();
    const section = async (name: string) => {
        const reply = await run(ctx, "character", { name: "Chaos Chris" }, name);
        const [embed] = reply.embeds;
        assert.ok(embed, `${name} has no embed`);
        assert.equal(embed.author?.name, "Chaos Chris · 24 Orc Warlock");
        assertWithinLimits(embed);
        return embed;
    };

    const gear = await section("gear");
    assert.match(gear.description ?? "", /🔵 \*\*Chest\*\* — Robes of Arugal · ilvl 26 · \*\+3 Stamina\*/);
    assert.match(gear.description ?? "", /🟢 \*\*Head\*\* — Shadow Hood · ilvl 24/);

    const stats = await section("stats");
    assert.match(field(stats, "Vitals") ?? "", /Health \*\*812\*\*\nMana \*\*1,104\*\*/);
    assert.match(field(stats, "Attributes") ?? "", /Intellect \*\*74\*\* \(51 base\)/);
    assert.match(field(stats, "Spell") ?? "", /Crit 4\.51%/);
    assert.equal(field(stats, "Resistances"), "Shadow 10");

    const talents = await section("talents");
    assert.equal(field(talents, "Affliction (10)"), "Improved Corruption 5, Suppression 5");
    assert.equal(field(talents, "Destruction (0)"), "—");

    const professions = await section("professions");
    assert.match(field(professions, "Primary") ?? "", /\*\*Tailoring\*\* 110\/150\n\*\*Enchanting\*\*\nJourneyman: 95\/150 · 1 recipes/);

    const reputations = await section("reputations");
    assert.match(reputations.description ?? "", /^\*\*Orgrimmar\*\* — Friendly \(1,500\/6,000\)\n\*\*Undercity\*\*/);
});

test("/character render shows the full-body render when there is one", async () => {
    const api = fakeApi();
    const reply = await run(fakeContext(api), "character", { name: "Chaos Chris" }, "render");
    const [embed] = reply.embeds;
    assert.equal(embed?.title, "Render");
    assert.equal(embed?.author?.name, "Chaos Chris · 24 Orc Warlock");
    assert.equal(embed?.image?.url, "https://render.worldofwarcraft.com/forever-us/character/20/4242-main-raw.png");
    assert.equal(embed?.description, undefined);

    // The render shows up hours after the character does: until then the media endpoint returns 404.
    api.state.mediaExists = false;
    const pending = await run(fakeContext(api), "character", { name: "Chaos Chris" }, "render");
    assert.equal(pending.embeds[0]?.image, undefined);
    assert.equal(pending.embeds[0]?.description, "No render available yet.");

    api.state.characterExists = false;
    const missing = await run(fakeContext(api), "character", { name: "Chaos Chris" }, "render");
    assert.equal(missing.embeds.length, 0);
    assert.match(missing.content ?? "", /couldn't find \*\*Chaos Chris\*\*/);
});

test("/character explains a missing character and a bad name", async () => {
    const api = fakeApi();
    api.state.characterExists = false;
    const missing = await run(fakeContext(api), "character", { name: "Chaos Chris" }, "gear");
    assert.equal(missing.embeds.length, 0);
    assert.match(missing.content ?? "", /couldn't find \*\*Chaos Chris\*\* in the US region.*level 10.*logging out/s);

    const bad = await run(fakeContext(), "character", { name: "Chaos" }, "info");
    assert.ok(bad.ephemeral);
    assert.ok(!bad.deferred);
    assert.match(bad.content ?? "", /first name and a surname/);
});

test("/character suggests guild members", async () => {
    const ctx = fakeContext();
    const choices = await complete(ctx, "character", "cha");
    assert.deepEqual(choices, [{ name: "Chaos Chris · 24 Warlock", value: "Chaos Chris" }]);
    assert.equal((await complete(ctx, "character", "")).length, 25);
    assert.deepEqual(await complete(fakeContext(fakeApi(), { defaultGuild: undefined }), "character", "cha"), []);
});

test("/guild info summarises the default guild", async () => {
    const reply = await run(fakeContext(), "guild", {}, "info");
    const [embed] = reply.embeds;
    assert.equal(embed?.title, "<Burning Legion>");
    assert.equal(field(embed, "Members"), "45");
    assert.equal(field(embed, "Ruleset"), "Roleplay PvP");
    assert.equal(field(embed, "Guild master"), "Grom Hellscream");
    assert.match(field(embed, "Levels") ?? "", /^Highest 31 \(1\)\nAverage \d+\.\d$/);
    assert.match(field(embed, "Classes") ?? "", /Warlock 6/);
    assertWithinLimits(embed!);
});

test("/guild roster lists, filters and pages", async () => {
    const ctx = fakeContext();
    const first = await run(ctx, "guild", {}, "roster");
    const lines = first.embeds[0]?.description?.split("\n") ?? [];
    assert.equal(lines.length, 20);
    // Highest level first by default, then by name; ranks show the guild's names for them.
    assert.equal(lines[0], "`31` **Grom Hellscream** — Orc Warrior · Guild master");
    assert.equal(lines[1], "`29` **GruntY Number24** — Orc Warrior · Officer");
    assert.equal(lines[2], "`28` **GruntX Number23** — Troll Druid · Rank 5");
    assert.equal(lines[4], "`26` **GruntV Number21** — Undead Mage · Member");
    assert.equal(lines[6], "`24` **Chaos Chris** — Orc Warlock · Warchief");
    assert.deepEqual(lines.map((line) => Number(line.slice(1, 3))), [31, 29, 28, 27, 26, 25, 24, 24, 23, 22, 22, 21, 21, 20, 20, 19, 19, 18, 18, 17]);
    assert.equal(first.embeds[0]?.footer?.text, "45 of 45 members · sorted by level · page 1/3");

    const byRank = await run(ctx, "guild", { sort: "rank" }, "roster");
    assert.match(byRank.embeds[0]?.description ?? "", /^`31` \*\*Grom Hellscream\*\*.*\n`24` \*\*Chaos Chris\*\*.*Warchief\n`29` .* Officer\n/);
    assert.match(byRank.embeds[0]?.footer?.text ?? "", /sorted by rank/);
    assert.deepEqual(first.buttons.map((button) => [button.label, button.disabled]), [["◀ Previous", true], ["Next ▶", false]]);
    assertWithinLimits(first.embeds[0]!);

    const next = first.buttons[1]!;
    assert.ok(next.customId.length <= 100);
    const second = await press(ctx, next.customId);
    assert.match(second.embeds[0]?.footer?.text ?? "", /page 2\/3$/);
    const last = await press(ctx, second.buttons[1]!.customId);
    assert.equal(last.embeds[0]?.description?.split("\n").length, 5);
    assert.deepEqual(last.buttons.map((button) => button.disabled), [false, true]);

    // The class comes as an ID from autocomplete, or as a name when typed.
    assert.deepEqual(await complete(ctx, "guild", "war"), [{ name: "Warlock", value: "9" }, { name: "Warrior", value: "1" }]);
    for (const value of ["9", "warlock"]) {
        const warlocks = await run(ctx, "guild", { class: value, min_level: 20, sort: "level" }, "roster");
        const rows = warlocks.embeds[0]?.description?.split("\n") ?? [];
        assert.ok(rows.length > 0 && rows.every((row) => row.includes("Warlock")), rows.join("\n"));
        assert.match(rows[0] ?? "", /^`2\d`/);
        assert.match(warlocks.embeds[0]?.footer?.text ?? "", /of 45 members · Warlock, level 20\+ · sorted by level/);
        assert.equal(warlocks.buttons.length, 0);
    }

    const unknownClass = await run(ctx, "guild", { class: "bard" }, "roster");
    assert.match(unknownClass.content ?? "", /don't know a class called \*\*bard\*\*/);
});

test("/guild handles an unknown guild and a missing default", async () => {
    const unknown = await run(fakeContext(), "guild", { guild: "Nope" }, "info");
    assert.match(unknown.content ?? "", /couldn't find a guild called \*\*Nope\*\*/);
    const none = await run(fakeContext(fakeApi(), { defaultGuild: undefined }), "guild", {}, "roster");
    assert.ok(none.ephemeral);
    assert.match(none.content ?? "", /DEFAULT_GUILD/);
});

test("/price shows the default faction's houses", async () => {
    const reply = await run(fakeContext(), "price", { item: String(LINEN) });
    const [embed] = reply.embeds;
    assert.equal(embed?.title, "Linen Cloth");
    assert.equal(
        embed?.description,
        [
            "Common · Cloth (Tradeskill)",
            "",
            "**Horde Auction House #111**",
            "from **1s 61c** each · 21 available in 2 listings",
            "**Horde Auction House #114**",
            "from **1s 64c** each · 21 available in 2 listings",
            "**Blackwater Auction House #113**",
            "from **1s 63c** each · 21 available in 2 listings",
        ].join("\n"),
    );
    assert.equal(field(embed, "Lowest buyout"), "1s 61c");
    assert.equal(field(embed, "Vendor sells for"), "55c");
    assert.match(field(embed, "Prices from") ?? "", /^<t:\d+:R>$/);
    assert.equal(embed?.footer?.text, "Item 2589");
    assertWithinLimits(embed!);
});

test("/price takes a typed name, another faction, and bid-only items missing from Forever", async () => {
    const ctx = fakeContext();
    const alliance = await run(ctx, "price", { item: "brawler gloves", faction: "alliance" });
    const [embed] = alliance.embeds;
    assert.equal(embed?.title, "Brawler Gloves");
    assert.match(embed?.description ?? "", /\*\*Alliance Auction House #110\*\*\nbid only, from \*\*9s\*\* each · 1 available in 1 listing\n/);
    assert.doesNotMatch(embed?.description ?? "", /Horde/);
    assert.match(embed?.footer?.text ?? "", /^Item 720 · Retail data$/);

    const all = await run(ctx, "price", { item: String(LINEN), faction: "all" });
    assert.match(all.embeds[0]?.description ?? "", /Horde Auction House #111[\s\S]*Alliance Auction House #110[\s\S]*Blackwater Auction House #113/);
});

test("/price reports no listings, failed houses and unknown items", async () => {
    const api = fakeApi();
    api.state.brokenHouses.add(114);
    const ctx = fakeContext(api);
    const wool = await run(ctx, "price", { item: "Wool Cloth" });
    assert.match(wool.embeds[0]?.description ?? "", /Horde Auction House #111\*\*\nfrom \*\*3s 10c\*\* each · 400 available in 1 listing$/m);
    assert.equal(field(wool.embeds[0], "Couldn't load"), "Horde Auction House #114");

    const none = await run(fakeContext(fakeApi(), { auctionHouseIds: [112] }), "price", { item: String(LINEN) });
    assert.equal(none.embeds[0]?.description, "No listings in the 1 auction house checked.");

    const unknown = await run(ctx, "price", { item: "zzzz" });
    assert.match(unknown.content ?? "", /couldn't find an item matching \*\*zzzz\*\*/);
});

test("item autocomplete lists matches, and listed items first once prices are loaded", async () => {
    const ctx = fakeContext();
    assert.deepEqual(await complete(ctx, "price", "c"), []);
    assert.deepEqual(await complete(ctx, "price", "cloth"), [
        { name: "Linen Cloth", value: "2589" },
        { name: "Wool Cloth", value: "2592" },
    ]);
    // With only wool on the auction house, it moves above the better name match.
    const woolOnly = fakeContext();
    woolOnly.auctions.isListed = (id) => id === 2592;
    assert.deepEqual((await complete(woolOnly, "price", "cloth")).map((choice) => choice.name), ["Wool Cloth", "Linen Cloth"]);
    assert.deepEqual((await complete(ctx, "item", "brawl")).map((choice) => choice.value), [String(BRAWLER_GLOVES)]);
});

test("/item shows a tooltip", async () => {
    const reply = await run(fakeContext(), "item", { item: "720" });
    const [embed] = reply.embeds;
    assert.equal(embed?.title, "Brawler Gloves");
    assert.equal(embed?.color, 0x1eff00);
    assert.equal(embed?.description, "Uncommon · Leather (Armor) · Hands");
    assert.equal(field(embed, "Item level"), "10");
    assert.equal(field(embed, "Max stack"), undefined);
    assertWithinLimits(embed!);
});

test("/rulesets shows each ruleset's status", async () => {
    const reply = await run(fakeContext(), "rulesets");
    assert.equal(reply.embeds[0]?.title, "WoW: Forever rulesets (US)");
    assert.equal(
        reply.embeds[0]?.description,
        "🟢 **PvP** — Up\n🟢 **Normal** — Up\n🔴 **Roleplay** — Down\n🟢 **Roleplay PvP** — Up",
    );
});

test("an API failure becomes a readable reply", async () => {
    const api = fakeApi();
    api.forever.characterProfile = async () => {
        throw Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    };
    const original = console.error;
    console.error = () => {};
    try {
        const reply = await run(fakeContext(api), "character", { name: "Chaos Chris" }, "info");
        assert.match(reply.content ?? "", /rate limiting/);
        assert.equal(reply.embeds.length, 0);
    } finally {
        console.error = original;
    }
    assert.match(errorMessage(Object.assign(new Error("x"), { statusCode: 401 })), /credentials/);
    assert.match(errorMessage(Object.assign(new Error("x"), { statusCode: 503 })), /having trouble/);
    assert.match(errorMessage(new Error("x")), /Something went wrong/);
});
