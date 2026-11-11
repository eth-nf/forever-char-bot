import { join } from "node:path";
import { createClient } from "@pinta365/blizzard_api";
import { ClaimStore } from "./claims/store.ts";
import { httpAuctionFeed } from "./blizzard/auctionFeed.ts";
import { AuctionService } from "./blizzard/auctions.ts";
import { ForeverService } from "./blizzard/service.ts";
import type { BotContext } from "./commands/types.ts";
import type { Config } from "./config.ts";

/** Wires the Blizzard client and the services the commands use. */
export function createContext(config: Config): BotContext {
    const client = createClient({
        region: config.blizzard.region,
        locale: config.blizzard.locale,
        clientId: config.blizzard.clientId,
        clientSecret: config.blizzard.clientSecret,
    });
    return {
        config,
        claims: new ClaimStore(config.dataDir && join(config.dataDir, "claims.json")),
        forever: new ForeverService(client.wowForever, client.wow, config.blizzard.locale),
        auctions: new AuctionService(
            {
                auctionHouses: (rulesetId) => client.wowForever.auctionHouses(rulesetId),
                ...httpAuctionFeed(client, config.blizzard.region, config.blizzard.locale),
            },
            {
                rulesetId: config.rulesetId,
                houseIds: config.auctionHouseIds,
                checkMs: config.auctionCheckMinutes * 60_000,
            },
        ),
    };
}
