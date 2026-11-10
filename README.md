# forever-char-bot

A Discord bot for looking up WoW: Forever characters, guilds and auction house prices from inside your server.

It reads the Blizzard API through [`@pinta365/blizzard_api`](https://github.com/Pinta365/blizzard_api). Blizzard hasn't
documented the Forever API yet, so anything here can change without notice. The library's
[Forever notes](https://blizzard.pinta.land/forever/) track what currently works.

## Commands

| Command | What it shows |
| :- | :- |
| `/character info name:First Last` | Level, race, class, ruleset, guild, talents, professions, PvP rank, last seen |
| `/character gear` | Equipped items with item level and enchants |
| `/character stats` | Attributes, defenses, melee and spell stats, resistances |
| `/character talents` | Points per tree and the talents picked |
| `/character professions` | Profession skill levels |
| `/character reputations` | Reputation standings |
| `/character render` | The full-body render, once Blizzard has made one |
| `/guild info [guild]` | Members, guild master, level spread, class and race make-up |
| `/guild roster [guild] [class] [min_level] [sort]` | The characters in the guild, 20 per page |
| `/who [member]` | The characters a server member has claimed (yours if no member is given) |
| `/claim name:First Last` | Claim a character as yours |
| `/unclaim name:First Last` | Release a character you claimed |
| `/claims assign member:@someone name:First Last` | Admins: give a character to a member, taking it from whoever has it |
| `/claims unassign name:First Last` | Admins: remove a character from the member who has it |
| `/claims list` | Admins: every claimed character in the server |
| `/price item:Linen Cloth [faction]` | Lowest buyout and quantity per auction house |
| `/item item:Linen Cloth` | An item's tooltip |
| `/rulesets` | The region's rulesets and whether they're up |

Character names autocomplete from your guild's roster, and item names from the item database.

## Setup

You need [Node.js](https://nodejs.org) 22.18 or newer. It runs the TypeScript directly, so there is no build step.

1. **Blizzard API client.** At <https://develop.battle.net/access/clients>, create a client. Copy its client ID and
   secret.
2. **Discord application.** At <https://discord.com/developers/applications>, create an application, open **Bot** and
   reset the token to get one. No privileged intents are needed.
3. **Invite the bot** to your server. Under **OAuth2 → URL Generator**, tick the `bot` and `applications.commands`
   scopes and open the generated URL.
4. **Configure.** Copy `.env.example` to `.env` and fill in the token, the client ID and secret, your server ID and
   your guild's name.
5. **Check the Blizzard side** before starting the bot:

   ```bash
   npm install
   ```

   ```bash
   npm run smoke
   ```

   This looks up Chaos Chris (or `npm run smoke -- "First Last"`), the guild, an item and the auction houses, and
   prints what each command would show.
6. **Run it:**

   ```bash
   npm start
   ```

The bot has to keep running to answer commands, so host it on something that stays on.

## Claims

Members link characters to their Discord account with `/claim`, and `/who` shows a member's characters. A claimed
character's `/character info` card also names the member who plays it.

- A character belongs to one member per server. A member can have up to 20.
- The bot checks that the character exists before accepting a claim. It can't check that the member really plays it,
  which is what `/claims` is for.
- `/claims` is limited to members with the **Manage Server** permission. To let other roles use it, change it under
  **Server Settings → Integrations → the bot**.
- Claims are saved in `data/claims.json` (set `DATA_DIR` to move it). Back that file up if the claims matter to you.

## Things to know

- **Characters appear from level 10, after logging out.** Before that the API returns 404, and the bot says so.
  Everything shown is a snapshot from the character's last logout.
- **Avatars lag.** A character's render can take hours to a day to appear after the character does. The card works
  without it.
- **Fifteen auction houses.** Each region lists five Alliance, five Horde and five neutral (Blackwater) houses, and
  the API doesn't say which one serves which players. `/price` shows each house of your faction separately. Once
  you've matched yours against in-game prices, set `AH_HOUSE_IDS` to show only those.
- **Auction data is big and about hourly.** A busy house is around 9 MB. The bot keeps only a per-item summary in
  memory, loads it at startup, and refreshes it in the background when it is older than `AH_MAX_AGE_MINUTES`.
- **Item data has gaps.** About 4 in 10 auctioned items are missing from Forever's item data. The bot falls back to
  Retail's data for the name, quality and icon, and marks the result: Retail's stats can differ.
- **Stack prices.** Prices are shown per single item: a stack's buyout is divided by its size.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

The tests run every command against a fake Blizzard API (`tests/fixtures.ts`), and run the services on the real
library with the network stubbed to check the requests it sends. They need no credentials.

| Path | What's there |
| :- | :- |
| `src/blizzard/` | API access: caching, the Retail item fallback, auction price summaries |
| `src/claims/` | Which member plays which character, saved to a JSON file |
| `src/views/` | The Discord embeds, built from API data |
| `src/commands/` | The slash commands and the interaction router |
| `scripts/smoke.ts` | The live check against the real API |

## License

[MIT](LICENSE)
