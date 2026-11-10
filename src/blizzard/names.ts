/** A Forever character's two-part name. Characters are realmless: the pair is unique per region. */
export interface CharacterName {
    name: string;
    surname: string;
}

/**
 * Parses what a player types into a character's two-part name. Accepts "Chaos Chris", "chaos-chris" and extra
 * whitespace. Returns undefined when the input isn't exactly two parts.
 */
export function parseCharacterName(input: string): CharacterName | undefined {
    const parts = input
        .trim()
        .split(/[\s\-_]+/)
        .filter(Boolean);
    if (parts.length !== 2) return undefined;
    const [name, surname] = parts as [string, string];
    return { name, surname };
}

/** The API slug of a character: `{name}-{surname}` in lowercase. */
export function characterSlug({ name, surname }: CharacterName): string {
    return `${name}-${surname}`.toLowerCase();
}

/** The API slug of a guild: its name in lowercase, with spaces as hyphens. */
export function guildSlug(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/['’`]/g, "")
        .replace(/\s+/g, "-");
}
