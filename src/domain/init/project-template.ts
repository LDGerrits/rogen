import { PlannedFile } from "../toolchain/toolchain.js";
import { fillTemplate } from "./fill-template.js";
import { InitKind } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const README = "README.md";

const ROBLOX_LOCKS =
	"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n";

export interface IgnoredFiles {
	readonly compiled: readonly string[];
	readonly installed: readonly string[];
}

const section = (heading: string, lines: readonly string[]): string =>
	lines.length > 0 ? `\n# ${heading}\n${lines.join("\n")}\n` : "";

export class ProjectTemplate {
	constructor(
		readonly kind: InitKind,
		readonly name: string,
		readonly ignored: IgnoredFiles = { compiled: [], installed: [] }
	) {}

	get readme(): PlannedFile | undefined {
		return this.ownFile((file) => file === README);
	}

	get gitignore(): PlannedFile {
		const { name } = this;
		const project =
			this.kind === "place"
				? `# Place files\n/*.rbxl\n/*.rbxlx\n\n${ROBLOX_LOCKS}`
				: this.kind === "plugin"
					? `# Plugin model files\n/${name}.rbxmx\n/${name}.rbxm\n`
					: ROBLOX_LOCKS;
		const { compiled, installed } = this.ignored;
		return {
			fileName: ".gitignore",
			content: `${project}\nsourcemap.json\n*.project.json\n${section("Compiler output", compiled)}${section("Installed packages", installed)}`,
		};
	}

	get script(): PlannedFile | undefined {
		return this.ownFile((file) => file !== README);
	}

	private ownFile(
		matches: (file: string) => boolean
	): PlannedFile | undefined {
		if (this.kind === "place") return undefined;
		const found = [...templateFiles(this.kind)].find(([file]) =>
			matches(file)
		);
		return (
			found && {
				fileName: found[0],
				content: fillTemplate(found[1], { name: this.name }),
			}
		);
	}
}
