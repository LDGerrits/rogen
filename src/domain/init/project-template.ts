import { PlannedFile } from "../toolchain/toolchain.js";
import { fillTemplate } from "./fill-template.js";
import { InitKind } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const README = "README.md";

const ROBLOX_LOCKS =
	"# Roblox Studio lock files\n/*.rbxlx.lock\n/*.rbxl.lock\n";

/** The files `rojo init --kind` writes beside the project file, where none exists: Rojo's own contents, with Rogen's commands in the README. */
export class ProjectTemplate {
	constructor(
		readonly kind: InitKind,
		/** The project's name, which Rojo takes from the folder. */
		readonly name: string,
		/** Lines the language adds to the `.gitignore`. */
		readonly ignored: readonly string[] = []
	) {}

	/** The README of a model or a plugin; a place's comes with its sample. */
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

	/** The one script of a model or a plugin, which the project mounts as `src`; a place's code is its routes'. */
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
