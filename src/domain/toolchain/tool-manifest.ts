import path from "path";

interface ToolchainManager {
	readonly id: string;
	readonly fileName: string;
	readonly adds: boolean;
	readonly pinsInTable: boolean;
}

const MANAGERS: readonly ToolchainManager[] = [
	{ id: "rokit", fileName: "rokit.toml", adds: true, pinsInTable: false },
	{ id: "aftman", fileName: "aftman.toml", adds: true, pinsInTable: false },
	{ id: "foreman", fileName: "foreman.toml", adds: false, pinsInTable: true },
];

const unquoted = (key: string) => key.replace(/^(["'])(.*)\1$/, "$2");

function sourceOf(value: string): string | undefined {
	const spec = /^["']([^"'@]+)@[^"']*["']$/.exec(value);
	if (spec) return spec[1];
	const table = /\b(?:source|github|gitlab)\s*=\s*["']([^"']+)["']/.exec(
		value
	);
	return table?.[1];
}

export class ToolManifest {
	static readonly FILE_NAMES: readonly string[] = MANAGERS.map(
		({ fileName }) => fileName
	);

	private constructor(
		readonly file: string,
		private readonly manager: ToolchainManager,
		private readonly tools: ReadonlyMap<string, string>
	) {}

	/** `undefined` when `file` is not the manifest of a known manager. */
	static parse(file: string, text: string): ToolManifest | undefined {
		const manager = MANAGERS.find(
			({ fileName }) => fileName === path.basename(file)
		);
		if (!manager) return undefined;
		const tools = new Map<string, string>();
		let inTools = false;
		for (const raw of text.split(/\r?\n/)) {
			const line = raw.replace(/\s+#.*$/, "").trim();
			if (line.startsWith("[")) {
				inTools = /^\[\s*tools\s*\]$/.test(line);
				continue;
			}
			const entry = /^("[^"]+"|'[^']+'|[\w-]+)\s*=\s*(.+)$/.exec(line);
			if (!inTools || !entry) continue;
			const source = sourceOf(entry[2]);
			if (source) tools.set(unquoted(entry[1]), source.toLowerCase());
		}
		return new ToolManifest(file, manager, tools);
	}

	nameOf(repository: string): string | undefined {
		const wanted = repository.toLowerCase();
		for (const [name, source] of this.tools)
			if (source === wanted) return name;
		return undefined;
	}

	pinOf(name: string, repository: string, version: string): string {
		return this.manager.pinsInTable
			? `${name} = { github = "${repository}", version = "${version}" }`
			: `${name} = "${repository}@${version}"`;
	}

	get installCommand(): string {
		return `${this.manager.id} install`;
	}

	addCommand(repository: string): string | undefined {
		return this.manager.adds
			? `${this.manager.id} add ${repository}`
			: undefined;
	}
}
