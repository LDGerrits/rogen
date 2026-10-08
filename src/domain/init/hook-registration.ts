/** What registering the hook does to an agent's hook file. */
export type HookRegistration =
	| { readonly kind: "added"; readonly text: string }
	| { readonly kind: "present" }
	| { readonly kind: "unreadable" };

/** What an agent's hook file needs for the hook. */
export interface HookEntry {
	/** The event the agent runs it on when its turn ends. */
	readonly event: string;
	/** The entry in the event's list, as the agent writes it. */
	readonly entry: unknown;
	/** What a new file starts with, for an agent whose files carry one. */
	readonly version?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function indentOf(text: string): string {
	return /^\t/m.test(text) ? "\t" : (/^( +)\S/m.exec(text)?.[1] ?? "\t");
}

/** The file's text with the entry added to its event, or why it can't be: the file names the script already, or isn't plain JSON of the shape the agents read. `text` is `undefined` when the file doesn't exist. */
export function registerHook(
	text: string | undefined,
	{ event, entry, version }: HookEntry
): HookRegistration {
	let settings: unknown = {};
	if (text !== undefined) {
		try {
			settings = JSON.parse(text);
		} catch {
			return { kind: "unreadable" };
		}
	}
	if (!isObject(settings)) return { kind: "unreadable" };
	const { hooks = {} } = settings;
	if (!isObject(hooks)) return { kind: "unreadable" };
	const { [event]: listed = [] } = hooks;
	if (!Array.isArray(listed)) return { kind: "unreadable" };
	if (JSON.stringify(listed).includes("rogen-check.sh"))
		return { kind: "present" };

	const registered = {
		...(text === undefined && version !== undefined && { version }),
		...settings,
		hooks: { ...hooks, [event]: [...listed, entry] },
	};
	const json = JSON.stringify(registered, null, indentOf(text ?? ""));
	return {
		kind: "added",
		text: text === undefined || text.endsWith("\n") ? `${json}\n` : json,
	};
}
