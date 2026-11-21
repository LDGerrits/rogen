import { PlannedFile } from "../toolchain/toolchain.js";
import { fillTemplate } from "./fill-template.js";
import { InitKind } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const README = "README.md";

const ROBLOX_LOCKS =
	"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n";

export class ProjectTemplate {
	constructor(
		readonly kind: InitKind,
		readonly name: string,
		readonly ignored: readonly string[] = []
	) {}

	get readme(): PlannedFile | undefined {
		return this.ownFile((file) => file === README);
	}

	get gitignore(): PlannedFile {
		const { name } = this;
		const project =
			this.kind === "place"
				? `# Project place file\n/${name}.rbxlx\n\n${ROBLOX_LOCKS}`
				: this.kind === "plugin"
					? `# Plugin model files\n/${name}.rbxmx\n/${name}.rbxm\n`
					: ROBLOX_LOCKS;
		const language =
			this.ignored.length > 0
				? `\n# Compiler output and installed packages\n${this.ignored.join("\n")}\n`
				: "";
		return {
			fileName: ".gitignore",
			content: `${project}\nsourcemap.json\n*.project.json\n${language}`,
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
