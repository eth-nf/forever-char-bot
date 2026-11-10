import type {
    ApplicationCommandOptionChoiceData,
    AutocompleteInteraction,
    ButtonInteraction,
    ChatInputCommandInteraction,
    RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { AuctionService } from "../blizzard/auctions.ts";
import type { ForeverService } from "../blizzard/service.ts";
import type { ClaimStore } from "../claims/store.ts";
import type { Config } from "../config.ts";

export interface BotContext {
    config: Config;
    forever: ForeverService;
    auctions: AuctionService;
    claims: ClaimStore;
}

export interface Command {
    data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
    execute(interaction: ChatInputCommandInteraction, ctx: BotContext): Promise<void>;
    autocomplete?(interaction: AutocompleteInteraction, ctx: BotContext): Promise<ApplicationCommandOptionChoiceData[]>;
    /** Buttons whose custom ID starts with `${buttonPrefix}|` are routed to `button`. */
    buttonPrefix?: string;
    button?(interaction: ButtonInteraction, ctx: BotContext): Promise<void>;
}

/** Autocomplete must answer within 3 seconds. Resolves to `fallback` if `work` takes longer than `ms`. */
export async function within<T>(ms: number, work: Promise<T>, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    try {
        return await Promise.race([work.catch(() => fallback), timeout]);
    } finally {
        clearTimeout(timer);
    }
}
