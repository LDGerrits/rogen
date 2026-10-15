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
		private readonly tools: ReadonlyMap<string, string>,
		private readonly text: string
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
		return new ToolManifest(file, manager, tools, text);
	}

	nameOf(repository: string): string | undefined {
		const wanted = repository.toLowerCase();
		for (const [name, source] of this.tools)
			if (source === wanted) return name;
		return undefined;
	}

	/** Whether a tool is listed under `name`, whatever it is. */
	uses(name: string): boolean {
		return this.tools.has(name);
	}

	pinOf(name: string, repository: string, version: string): string {
		return this.manager.pinsInTable
			? `${name} = { github = "${repository}", version = "${version}" }`
			: `${name} = "${repository}@${version}"`;
	}

	/** The file's text with the entry added at the end of its tools section. */
	withPin(name: string, repository: string, version: string): string {
		const entry = this.pinOf(name, repository, version);
		const eol = this.text.includes("\r\n") ? "\r\n" : "\n";
		const lines = this.text.split(/\r?\n/);
		if (lines.at(-1) === "") lines.pop();
		const start = lines.findIndex((line) =>
			/^\[\s*tools\s*\]$/.test(line.replace(/\s+#.*$/, "").trim())
		);
		if (start === -1) {
			const gap =
				lines.length === 0
					? ""
					: this.text.endsWith("\n")
						? eol
						: eol + eol;
			return `${lines.length === 0 ? "" : this.text}${gap}[tools]${eol}${entry}${eol}`;
		}
		const next = lines.findIndex(
			(line, index) => index > start && line.trim().startsWith("[")
		);
		let last = start;
		for (
			let index = start + 1;
			index < (next === -1 ? lines.length : next);
			index++
		)
			if (!/^(#|$)/.test(lines[index].trim())) last = index;
		lines.splice(last + 1, 0, entry);
		return lines.join(eol) + eol;
	}

	get managerId(): string {
		return this.manager.id;
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
