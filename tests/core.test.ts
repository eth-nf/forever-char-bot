import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ClaimStore } from "../src/claims/store.ts";
import { aggregateListings, houseFaction } from "../src/blizzard/auctions.ts";
import { characterSlug, guildSlug, parseCharacterName } from "../src/blizzard/names.ts";
import { ConfigError, loadConfig } from "../src/config.ts";
import { mapLimit, TtlCache } from "../src/util/cache.ts";
import { fitLines, formatMoney } from "../src/views/format.ts";
import { BRAWLER_GLOVES, fakeApi, fakeContext, LINEN, WOOL } from "./fixtures.ts";

test("character names are parsed from what a player types", () => {
    assert.deepEqual(parseCharacterName("Chaos Chris"), { name: "Chaos", surname: "Chris" });
    assert.deepEqual(parseCharacterName("  chaos   chris "), { name: "chaos", surname: "chris" });
    assert.deepEqual(parseCharacterName("chaos-chris"), { name: "chaos", surname: "chris" });
    assert.deepEqual(parseCharacterName("Sédexus Shimizu"), { name: "Sédexus", surname: "Shimizu" });
    assert.equal(parseCharacterName("Chaos"), undefined);
    assert.equal(parseCharacterName("Chaos Chris Junior"), undefined);
    assert.equal(parseCharacterName(""), undefined);
    assert.equal(characterSlug({ name: "Chaos", surname: "Chris" }), "chaos-chris");
});

test("guild names become slugs", () => {
    assert.equal(guildSlug("Burning Legion"), "burning-legion");
    assert.equal(guildSlug("  Hand of  Gul'dan "), "hand-of-guldan");
    assert.equal(guildSlug("burning-legion"), "burning-legion");
});

test("money is formatted as gold, silver and copper", () => {
    assert.equal(formatMoney(0), "0c");
    assert.equal(formatMoney(7), "7c");
    assert.equal(formatMoney(200), "2s");
    assert.equal(formatMoney(123_456), "12g 34s 56c");
    assert.equal(formatMoney(10_000), "1g");
    assert.equal(formatMoney(12_345_670_000), "1,234,567g");
});

test("fitLines keeps output under the limit and says what was cut", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line number ${index}`);
    const text = fitLines(lines, 200);
    assert.ok(text.length <= 200, `${text.length} characters`);
    assert.match(text, /…and \d+ more$/);
    assert.equal(fitLines(["a", "b"], 200), "a\nb");
});

test("config reports every missing value at once and applies defaults", () => {
    assert.throws(() => loadConfig({}), (error: Error) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /DISCORD_TOKEN, BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET/);
        return true;
    });
    const config = loadConfig({ DISCORD_TOKEN: "t", BLIZZARD_CLIENT_ID: "i", BLIZZARD_CLIENT_SECRET: "s", AH_HOUSE_IDS: "111, 113" });
    assert.equal(config.blizzard.region, "us");
    assert.equal(config.blizzard.locale, "en_US");
    assert.equal(config.rulesetId, 15);
    assert.deepEqual(config.auctionHouseIds, [111, 113]);
    assert.equal(loadConfig({ BLIZZARD_CLIENT_ID: "i", BLIZZARD_CLIENT_SECRET: "s" }, { requireDiscord: false }).discordToken, "");
    assert.throws(() => loadConfig({ DISCORD_TOKEN: "t", BLIZZARD_CLIENT_ID: "i", BLIZZARD_CLIENT_SECRET: "s", BLIZZARD_REGION: "mars" }), ConfigError);
    assert.throws(() => loadConfig({ DISCORD_TOKEN: "t", BLIZZARD_CLIENT_ID: "i", BLIZZARD_CLIENT_SECRET: "s", DEFAULT_FACTION: "neutral" }), ConfigError);
});

test("claims are saved to disk and survive a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forever-claims-"));
    const path = join(dir, "nested", "claims.json");
    try {
        const store = new ClaimStore(path);
        const claim = (slug: string, userId: string, claimedAt: number) => ({ slug, name: slug, surname: "x", userId, claimedAt });
        // Changes made at the same time must all end up in the file.
        await Promise.all([
            store.set("s1", claim("b-b", "u1", 2)),
            store.set("s1", claim("a-a", "u1", 1)),
            store.set("s1", claim("c-c", "u2", 3)),
            store.set("s2", claim("a-a", "u9", 4)),
        ]);
        assert.equal((await store.set("s1", claim("c-c", "u1", 5)))?.userId, "u2");
        assert.equal((await store.remove("s1", "b-b"))?.slug, "b-b");
        assert.equal(await store.remove("s1", "b-b"), undefined);

        const reopened = new ClaimStore(path);
        assert.deepEqual(reopened.forUser("s1", "u1").map((entry) => entry.slug), ["a-a", "c-c"]);
        assert.deepEqual(reopened.forUser("s1", "u2"), []);
        assert.equal(reopened.owner("s2", "a-a")?.userId, "u9");
        assert.equal(reopened.owner("s3", "a-a"), undefined);
        assert.deepEqual(readdirSync(join(dir, "nested")), ["claims.json"]);

        // A damaged file stops the bot instead of being silently replaced by an empty one.
        writeFileSync(path, "{ not json");
        assert.throws(() => new ClaimStore(path), /claims file .* can't be read/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("the cache shares concurrent loads and reloads after expiry", async () => {
    let loads = 0;
    const cache = new TtlCache<number>(20);
    const load = async () => ++loads;
    assert.deepEqual(await Promise.all([cache.get("a", load), cache.get("a", load)]), [1, 1]);
    assert.equal(await cache.get("a", load), 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(await cache.get("a", load), 2);

    // A failed load isn't cached.
    await assert.rejects(cache.get("b", async () => Promise.reject(new Error("boom"))));
    assert.equal(await cache.get("b", async () => 5), 5);
});

test("mapLimit keeps order and respects the limit", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, ms));
        running--;
        return ms * 2;
    });
    assert.deepEqual(results, [60, 20, 40, 10]);
    assert.equal(peak, 2);
});

test("listings are reduced to a per-item price", () => {
    const items = aggregateListings(
        [
            { id: 1, item: { id: 10 }, buyout: 4000, bid: 1000, quantity: 20, time_left: "LONG" },
            { id: 2, item: { id: 10 }, buyout: 150, quantity: 1, time_left: "LONG" },
            { id: 3, item: { id: 11 }, bid: 900, quantity: 1, time_left: "LONG" },
        ],
        [
            { id: 4, item: { id: 12 }, quantity: 400, unit_price: 310, time_left: "LONG" },
            { id: 5, item: { id: 12 }, quantity: 5, unit_price: 290, time_left: "LONG" },
        ],
    );
    // A stack's buyout and bid cover the whole stack: 20 for 40s is 2s each, dearer than the single one at 1s 50c.
    assert.deepEqual(items.get(10), { quantity: 21, listings: 2, minBuyout: 150, minBid: 50 });
    assert.deepEqual(items.get(11), { quantity: 1, listings: 1, minBid: 900 });
    assert.deepEqual(items.get(12), { quantity: 405, listings: 2, minBuyout: 290 });
    assert.equal(aggregateListings(undefined, undefined).size, 0);
});

test("auction houses are grouped by faction from their name", () => {
    assert.equal(houseFaction("Alliance Auction House"), "alliance");
    assert.equal(houseFaction("Horde Auction House"), "horde");
    assert.equal(houseFaction("Blackwater Auction House"), "neutral");
});

test("prices come from the player's faction and the neutral houses", async () => {
    const api = fakeApi();
    const { auctions } = fakeContext(api);

    const horde = await auctions.prices(LINEN, "horde");
    assert.deepEqual(horde.rows.map((row) => row.house.id), [111, 112, 114, 113]);
    assert.deepEqual(horde.failed, []);
    assert.equal(horde.rows[0]?.price?.minBuyout, 161);
    assert.equal(horde.rows[0]?.price?.quantity, 21);
    // House 112 is empty: no `auctions` field and no commodities endpoint.
    assert.equal(horde.rows[1]?.price, undefined);

    // Commodities are part of the same snapshot. House 114 has auctions, but its commodities return 404.
    const wool = await auctions.prices(WOOL, "horde");
    assert.equal(wool.rows.find((row) => row.house.id === 111)?.price?.minBuyout, 310);
    assert.equal(wool.rows.find((row) => row.house.id === 114)?.price, undefined);

    // Snapshots are reused: one request per house, however many items are looked up.
    assert.equal(api.calls.auctionHouse, 4);
    assert.equal(api.calls.auctionHouses, 1);

    const all = await auctions.prices(BRAWLER_GLOVES);
    assert.equal(all.rows.length, 5);
    assert.equal(all.rows.find((row) => row.house.id === 110)?.price?.minBid, 900);
    assert.equal(auctions.isListed(LINEN), true);
    assert.equal(auctions.isListed(999_999), false);
});

test("a house that fails to load is reported, not fatal", async () => {
    const api = fakeApi();
    api.state.brokenHouses.add(111);
    const { auctions } = fakeContext(api);
    const result = await auctions.prices(LINEN, "horde");
    assert.deepEqual(result.failed.map((house) => house.id), [111]);
    assert.deepEqual(result.rows.map((row) => row.house.id), [112, 114, 113]);
});

test("AH_HOUSE_IDS limits which houses are used", async () => {
    const { auctions } = fakeContext(fakeApi(), { auctionHouseIds: [114] });
    const result = await auctions.prices(LINEN, "horde");
    assert.deepEqual(result.rows.map((row) => row.house.id), [114]);
});

test("a stale snapshot is served at once while a new one loads", async () => {
    const api = fakeApi();
    const { auctions } = fakeContext(api, { auctionMaxAgeMinutes: 0, auctionHouseIds: [111] });
    assert.equal(auctions.isListed(LINEN), undefined);
    const first = await auctions.prices(LINEN, "horde");
    const second = await auctions.prices(LINEN, "horde");
    assert.equal(second.rows[0]?.fetchedAt, first.rows[0]?.fetchedAt);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(api.calls.auctionHouse, 2);
    assert.ok((auctions.loaded(111)?.fetchedAt ?? 0) >= (first.rows[0]?.fetchedAt ?? 0));
});

test("items missing from Forever fall back to Retail", async () => {
    const { forever } = fakeContext();
    const linen = await forever.item(LINEN);
    assert.equal(linen?.source, "forever");
    assert.match(linen?.iconUrl ?? "", /item_2589/);

    const gloves = await forever.item(BRAWLER_GLOVES);
    assert.equal(gloves?.source, "retail");
    assert.equal(gloves?.item.name, "Brawler Gloves");
    assert.equal(await forever.item(1), undefined);
});

test("item search merges both sources and ranks the best match first", async () => {
    const { forever } = fakeContext();
    assert.deepEqual((await forever.searchItems("cloth")).map((hit) => [hit.name, hit.source]), [
        ["Linen Cloth", "forever"],
        ["Wool Cloth", "forever"],
    ]);
    assert.deepEqual((await forever.searchItems("Brawler")).map((hit) => [hit.id, hit.source]), [[BRAWLER_GLOVES, "retail"]]);
    assert.equal((await forever.resolveItem("wool cloth"))?.item.id, WOOL);
    assert.equal((await forever.resolveItem(String(BRAWLER_GLOVES)))?.item.id, BRAWLER_GLOVES);
    assert.equal(await forever.resolveItem("no such thing"), undefined);
    assert.deepEqual(await forever.searchItems("  "), []);
});

test("the character overview survives missing extras and caches requests", async () => {
    const api = fakeApi();
    api.state.mediaExists = false;
    const { forever } = fakeContext(api);
    const who = { name: "chaos", surname: "CHRIS" };
    const overview = await forever.overview(who);
    assert.equal(overview?.profile.character_class.name, "Warlock");
    assert.equal(overview?.avatarUrl, undefined);
    assert.equal(overview?.pvp?.pvp_rank, 2);

    await forever.overview({ name: "Chaos", surname: "Chris" });
    assert.equal(api.calls.characterProfile, 1);

    assert.equal(await forever.overview({ name: "Nobody", surname: "Here" }), undefined);
});

test("the guild roster gets class and race names", async () => {
    const { forever } = fakeContext();
    const overview = await forever.guild("Burning Legion");
    assert.equal(overview?.members.length, 45);
    const chris = overview?.members.find((member) => member.slug === "chaos-chris");
    assert.deepEqual([chris?.className, chris?.raceName, chris?.level], ["Warlock", "Orc", 24]);
    assert.equal(await forever.guild("No Such Guild"), undefined);
    assert.equal(forever.cachedGuild("burning legion")?.guild.id, 77);
});
