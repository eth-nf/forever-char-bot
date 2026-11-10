/**
 * Runs the services on the real API library with the network stubbed out, to check the requests that would be sent:
 * realmless character slugs, the Forever namespaces, and the Retail fallback for items.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createContext } from "../src/context.ts";
import { config, profile } from "./fixtures.ts";

interface Seen {
    path: string;
    query: Record<string, string>;
    namespace: string | null;
}

const seen: Seen[] = [];
const responses = new Map<string, unknown>();
const realFetch = globalThis.fetch;

before(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/token")) {
            return Response.json({ access_token: "test-token", token_type: "bearer", expires_in: 86_399 });
        }
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("Authorization"), "Bearer test-token");
        const namespace = headers.get("Battlenet-Namespace");
        seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), namespace });
        const body = responses.get(`${namespace} ${url.pathname}`);
        // The live API answers unknown characters and items with a 404 and no body.
        return body === undefined ? new Response(null, { status: 404, statusText: "Not Found" }) : Response.json(body);
    }) as typeof fetch;
});

after(() => {
    globalThis.fetch = realFetch;
});

const requests = () => seen.splice(0).map((request) => `${request.namespace} ${request.path}`);

test("character requests use the realmless slug and the Forever profile namespace", async () => {
    responses.set("profile-forever-us /profile/wow/character/chaos-chris", profile);
    const { forever } = createContext(config);

    const found = await forever.profile({ name: "Chaos", surname: "Chris" });
    assert.equal(found?.character_class.name, "Warlock");
    assert.equal(seen[0]?.query.locale, "en_US");
    assert.deepEqual(requests(), ["profile-forever-us /profile/wow/character/chaos-chris"]);

    // A character the API doesn't serve is "not found", not an error.
    assert.equal(await forever.profile({ name: "Nobody", surname: "Here" }), undefined);
    assert.equal(await forever.equipment({ name: "Chaos", surname: "Chris" }), undefined);
    assert.deepEqual(requests(), [
        "profile-forever-us /profile/wow/character/nobody-here",
        "profile-forever-us /profile/wow/character/chaos-chris/equipment",
    ]);
});

test("guild requests use the guild slug", async () => {
    const { forever } = createContext(config);
    assert.equal(await forever.guild("Burning Legion"), undefined);
    assert.deepEqual(requests().sort(), [
        "profile-forever-us /data/wow/guild/burning-legion",
        "profile-forever-us /data/wow/guild/burning-legion/roster",
        "static-forever-us /data/wow/playable-class/index",
        "static-forever-us /data/wow/playable-race/index",
    ]);
});

test("items are looked up in Forever first, then in Retail", async () => {
    responses.set("static-us /data/wow/item/720", { id: 720, name: "Brawler Gloves", quality: { type: "UNCOMMON", name: "Uncommon" } });
    const { forever } = createContext(config);
    const gloves = await forever.item(720);
    assert.equal(gloves?.source, "retail");
    assert.deepEqual(requests(), [
        "static-forever-us /data/wow/item/720",
        "static-us /data/wow/item/720",
        "static-us /data/wow/media/item/720",
    ]);
});

test("item search queries both item databases by localized name", async () => {
    responses.set("static-forever-us /data/wow/search/item", {
        page: 1, pageSize: 1, maxPageSize: 100, pageCount: 1,
        results: [{ key: { href: "x" }, data: { id: 2589, name: { en_US: "Linen Cloth" }, quality: { type: "COMMON" } } }],
    });
    const { forever } = createContext(config);
    assert.deepEqual(await forever.searchItems("Linen Cloth"), [{ id: 2589, name: "Linen Cloth", quality: "COMMON", source: "forever" }]);
    assert.deepEqual(seen[0]?.query, { locale: "en_US", "name.en_US": "linen cloth", _pageSize: "50" });
    assert.deepEqual(requests().sort(), ["static-forever-us /data/wow/search/item", "static-us /data/wow/search/item"]);
});

test("auction requests go through the configured ruleset, with the index's trailing slash", async () => {
    responses.set("dynamic-forever-us /data/wow/ruleset/15/auctions/", {
        auctions: [{ key: { href: "x" }, name: "Horde Auction House", id: 113 }, { key: { href: "x" }, name: "Alliance Auction House", id: 110 }],
    });
    responses.set("dynamic-forever-us /data/wow/ruleset/15/auctions/113", {
        id: 113, name: "Horde Auction House",
        auctions: [{ id: 1, item: { id: 2589 }, buyout: 4000, quantity: 20, time_left: "LONG" }],
    });
    const { auctions } = createContext(config);
    const result = await auctions.prices(2589, "horde");
    assert.deepEqual(result.rows.map((row) => [row.house.id, row.price?.minBuyout]), [[113, 200]]);
    assert.deepEqual(requests(), [
        "dynamic-forever-us /data/wow/ruleset/15/auctions/",
        "dynamic-forever-us /data/wow/ruleset/15/auctions/113",
        "dynamic-forever-us /data/wow/ruleset/15/auctions/113/commodities",
    ]);
});
