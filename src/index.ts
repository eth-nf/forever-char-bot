import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands, handleInteraction } from "./commands/index.ts";
import { ConfigError, loadConfig, loadEnvFile } from "./config.ts";
import { createContext } from "./context.ts";

loadEnvFile();

let config;
try {
    config = loadConfig();
} catch (error) {
    if (error instanceof ConfigError) {
        console.error(error.message);
        process.exit(1);
    }
    throw error;
}

const ctx = createContext(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
    console.log(`Logged in as ${ready.user.tag}.`);

    const body = commands.map((command) => command.data.toJSON());
    try {
        if (config.discordGuildId) {
            await ready.application.commands.set(body, config.discordGuildId);
            console.log(`Registered ${body.length} commands in server ${config.discordGuildId}.`);
        } else {
            await ready.application.commands.set(body);
            console.log(`Registered ${body.length} commands globally. They can take up to an hour to show up.`);
        }
    } catch (error) {
        console.error("Registering the slash commands failed:", error);
    }

    if (config.auctionWarmup) {
        // Loads the auction data now, so the first /price doesn't have to wait for it.
        ctx.auctions
            .housesFor(config.defaultFaction)
            .then((houses) => ctx.auctions.load(houses))
            .then(({ snapshots, failed }) => {
                console.log(`Auction data loaded for ${snapshots.length} houses${failed.length ? `, ${failed.length} failed` : ""}.`);
            })
            .catch((error) => console.warn("Loading auction data failed:", error.message));
    }
    // Keeps every house the bot has loaded up to date, whether or not anyone is running /price.
    ctx.auctions.startPolling((houses) => {
        const stamps = houses.map((house) => ctx.auctions.loaded(house.id)?.updatedAt ?? 0);
        console.log(`Auction data updated for ${houses.length} houses (Blizzard: ${new Date(Math.max(...stamps)).toISOString()}).`);
    });
    if (config.defaultGuild) {
        ctx.forever.guild(config.defaultGuild).then((overview) => {
            if (overview) console.log(`Default guild <${overview.guild.name}>: ${overview.members.length} members.`);
            else console.warn(`DEFAULT_GUILD "${config.defaultGuild}" was not found.`);
        }).catch((error) => console.warn("Loading the default guild failed:", error.message));
    }
});

client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction, ctx));
client.on(Events.Error, (error) => console.error("Discord client error:", error));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
        void client.destroy().finally(() => process.exit(0));
    });
}

await client.login(config.discordToken);
