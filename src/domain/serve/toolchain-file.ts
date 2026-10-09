import path from "path";

/** A toolchain manager, by the file a project pins its tools in. */
interface ToolchainManager {
	readonly id: string;
	readonly fileName: string;
	/** Whether it has an `add` command that pins a tool. */
	readonly adds: boolean;
}

/** In the order Rokit reads them, which reads the files of the other two as well. */
const MANAGERS: readonly ToolchainManager[] = [
	{ id: "rokit", fileName: "rokit.toml", adds: true },
	{ id: "aftman", fileName: "aftman.toml", adds: true },
	{ id: "foreman", fileName: "foreman.toml", adds: false },
];

const unquoted = (key: string) => key.replace(/^(["'])(.*)\1$/, "$2");

/** A `[tools]` entry's source: `owner/repo@version`, or a table with `source`, `github` or `gitlab`. */
function sourceOf(value: string): string | undefined {
	const spec = /^["']([^"'@]+)@[^"']*["']$/.exec(value);
	if (spec) return spec[1];
	const table = /\b(?:source|github|gitlab)\s*=\s*["']([^"']+)["']/.exec(
		value
	);
	return table?.[1];
}

/** The tools one file of a toolchain manager pins, by the name each runs as. */
export class ToolchainFile {
	static readonly FILE_NAMES: readonly string[] = MANAGERS.map(
		({ fileName }) => fileName
	);

	private constructor(
		readonly file: string,
		private readonly manager: ToolchainManager,
		/** Each tool's name to its source repository, in lower case. */
		private readonly tools: ReadonlyMap<string, string>
	) {}

	/** Reads `text` as the file `file`, whose name says which manager it belongs to; `undefined` for any other file. */
	static parse(file: string, text: string): ToolchainFile | undefined {
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
		return new ToolchainFile(file, manager, tools);
	}

	/** The name the tool from `repository` runs as, when this file pins it. */
	nameOf(repository: string): string | undefined {
		const wanted = repository.toLowerCase();
		for (const [name, source] of this.tools)
			if (source === wanted) return name;
		return undefined;
	}

	/** The command that installs every tool the file pins. */
	get installCommand(): string {
		return `${this.manager.id} install`;
	}

	/** The command that pins the tool from `repository` in this file, if the manager has one. */
	addCommand(repository: string): string | undefined {
		return this.manager.adds
			? `${this.manager.id} add ${repository}`
			: undefined;
	}
}
