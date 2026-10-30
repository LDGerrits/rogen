/** v1's words for where a file goes, and the service each sends it to. */
const SERVICES: Readonly<Record<string, string>> = {
	Server: "ServerScriptService",
	Client: "StarterPlayerScripts",
	Shared: "ReplicatedStorage",
	ServerScriptService: "ServerScriptService",
	ReplicatedStorage: "ReplicatedStorage",
	ReplicatedFirst: "ReplicatedFirst",
	ServerStorage: "ServerStorage",
	StarterGui: "StarterGui",
	StarterPack: "StarterPack",
	StarterPlayerScripts: "StarterPlayerScripts",
	StarterCharacterScripts: "StarterCharacterScripts",
	Workspace: "Workspace",
	Lighting: "Lighting",
	SoundService: "SoundService",
	RobloxPluginGuiService: "RobloxPluginGuiService",
};

const SERVICE_PARENTS: Readonly<Record<string, string>> = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
};

const SERVER_CONTAINERS = new Set(["ServerScriptService", "ServerStorage"]);

const CLIENT_CONTAINERS = new Set([
	"StarterPlayer",
	"StarterPlayerScripts",
	"StarterCharacterScripts",
	"StarterGui",
	"StarterPack",
	"ReplicatedFirst",
]);

const SERVER = "server";
const CLIENT = "client";
const FALLBACK = "shared";

/** The keywords that name their own wrapper folder where the service doesn't. */
const WRAPPERS = new Set([SERVER, CLIENT, FALLBACK]);

export type Casing = "PascalCase" | "camelCase";

/** How v1 laid out a service: its wrapper folders, and whether client scripts left StarterPlayer. */
export interface LayoutSettings {
	readonly casing: Casing;
	readonly unwrap: boolean;
	readonly emitLegacyScripts: boolean;
}

/** A keyword at the start or end of a file's name, which v1 routed the file by. */
export interface Affix {
	/** The keyword, in lower case. */
	readonly keyword: string;
	/** The name without the keyword and its separator. */
	readonly stripped: string;
	/** The keyword with its separator, as written. */
	readonly written: string;
}

interface Keyword {
	/** As the config or v1 spells it, which is the route key. */
	readonly key: string;
	readonly service: string;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** v1's routing keywords: its built-in services and words, and a config's aliases over them. */
export class LegacyKeywords {
	private readonly byLower = new Map<string, Keyword>();
	private readonly separatorSuffix: RegExp;
	private readonly pascalSuffix: RegExp;
	private readonly separatorPrefix: RegExp;
	private readonly camelPrefix: RegExp;
	private readonly spelled: Readonly<Record<string, string>>;

	constructor(aliases: Readonly<Record<string, string>> = {}) {
		this.spelled = { ...SERVICES, ...aliases };
		for (const [key, service] of Object.entries(this.spelled))
			this.byLower.set(key.toLowerCase(), { key, service });
		const longestFirst = (keys: string[]) =>
			[...new Set(keys)]
				.sort((a, b) => b.length - a.length)
				.map(escaped)
				.join("|");
		const lower = longestFirst([...this.byLower.keys()]);
		const spelled = longestFirst(Object.keys(this.spelled));
		this.separatorSuffix = new RegExp(`[.\\-_+](${lower})$`, "i");
		this.pascalSuffix = new RegExp(`(${spelled})$`);
		this.separatorPrefix = new RegExp(`^(${lower})([.\\-_+])`, "i");
		this.camelPrefix = new RegExp(
			`^(${longestFirst([...this.byLower.keys(), ...Object.keys(this.spelled)])})(?=[A-Z])`
		);
	}

	has(word: string): boolean {
		return this.byLower.has(word.toLowerCase());
	}

	/** The route key for `word`, spelled as the config or v1 spells it. */
	keyOf(word: string): string {
		return this.byLower.get(word.toLowerCase())?.key ?? word;
	}

	/** Where v1 put a file that `word` routed, as a route target. */
	targetOf(word: string, settings: LayoutSettings): string {
		const lower = word.toLowerCase();
		let service = this.byLower.get(lower)?.service ?? SERVICES.Shared;
		const wrapper = SERVER_CONTAINERS.has(service)
			? SERVER
			: CLIENT_CONTAINERS.has(service)
				? CLIENT
				: WRAPPERS.has(lower)
					? lower
					: FALLBACK;
		if (
			!settings.emitLegacyScripts &&
			SERVICE_PARENTS[service] !== undefined
		)
			service = SERVICES.Shared;
		return LegacyKeywords.join(service, wrapper, settings);
	}

	/** Whether v1 placed a service by itself under another, as StarterPlayerScripts under StarterPlayer. */
	static isNestedService(name: string): boolean {
		return SERVICE_PARENTS[name] !== undefined;
	}

	/** Where v1 put a file that no keyword routed. */
	static fallbackTarget(settings: LayoutSettings): string {
		return LegacyKeywords.join(SERVICES.Shared, FALLBACK, settings);
	}

	/** The keyword v1 read at the end or start of `name`, a file's name without its extension. */
	affixOf(name: string): Affix | undefined {
		const separatorSuffix = this.separatorSuffix.exec(name);
		if (separatorSuffix && separatorSuffix[0].length < name.length)
			return this.affix(
				separatorSuffix[1],
				name.slice(0, -separatorSuffix[0].length),
				separatorSuffix[0]
			);
		const pascalSuffix = this.pascalSuffix.exec(name);
		if (pascalSuffix && pascalSuffix[0].length < name.length)
			return this.affix(
				pascalSuffix[1],
				name.slice(0, -pascalSuffix[0].length),
				pascalSuffix[0]
			);
		const separatorPrefix = this.separatorPrefix.exec(name);
		if (separatorPrefix && separatorPrefix[0].length < name.length)
			return this.affix(
				separatorPrefix[1],
				name.slice(separatorPrefix[0].length),
				separatorPrefix[0]
			);
		const camelPrefix = this.camelPrefix.exec(name);
		if (camelPrefix && camelPrefix[0].length < name.length)
			return this.affix(
				camelPrefix[1],
				name.slice(camelPrefix[1].length),
				camelPrefix[0]
			);
		return undefined;
	}

	private affix(keyword: string, stripped: string, written: string): Affix {
		return { keyword: keyword.toLowerCase(), stripped, written };
	}

	private static join(
		service: string,
		wrapper: string,
		{ casing, unwrap }: LayoutSettings
	): string {
		const segments = service.split(".");
		const parent = SERVICE_PARENTS[segments[0]];
		const cased =
			casing === "PascalCase"
				? wrapper[0].toUpperCase() + wrapper.slice(1)
				: wrapper[0].toLowerCase() + wrapper.slice(1);
		return [
			...(parent ? [parent] : []),
			...segments,
			...(unwrap ? [] : [cased]),
		].join("/");
	}
}
