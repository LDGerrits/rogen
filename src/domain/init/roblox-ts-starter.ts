import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { PlannedCommand, PlannedScaffold } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const CREATE_TIMEOUT = 300_000;
const SCRIPT_TIMEOUT = 60_000;

const OUT_DIR = "out";

/** The variant whose `tsconfig.json` files make the places of `projects` compile with their common code. */
const PLACES_VARIANT = "roblox-ts-places";

/** What `init` takes from create-roblox-ts, which writes the project's `package.json`, `tsconfig.json` and compiler settings, and what it adds for places that share code. */
export class RobloxTsStarter {
	/** What a place compiles into its own folder, which its project file mounts from there. */
	static readonly OWN_FOLDERS: readonly string[] = ["include"];

	/** The starter of `language`, when it has one. */
	static of(language: Language): RobloxTsStarter | undefined {
		return language.id === "roblox-ts" ? new RobloxTsStarter() : undefined;
	}

	/** Lines for the `.gitignore` that create-roblox-ts would have written. */
	static ignored(several: boolean): string[] {
		return [
			"/node_modules",
			`/${OUT_DIR}`,
			"/include",
			"*.tsbuildinfo",
			...(several ? [`projects/*/${OUT_DIR}`, "projects/*/include"] : []),
		];
	}

	/** Runs create-roblox-ts in the folder, and drops its sample, which Rogen's replaces; with `several` places also its root `tsconfig.json` and the `src` folder, since no place is at the root. Git stays Rogen's step. */
	scaffold(several = false): PlannedScaffold {
		const args = [
			"create",
			"roblox-ts@latest",
			"--",
			"game",
			"--dir",
			".",
			"--yes",
			"--git=false",
			"--skipBuild",
		];
		return {
			command: {
				command: `npm ${args.join(" ")}`,
				file: "npm",
				args,
				timeout: CREATE_TIMEOUT,
			},
			replaces: several
				? ["default.project.json", "src", "tsconfig.json"]
				: [
						"default.project.json",
						"src/client",
						"src/server",
						"src/shared",
					],
		};
	}

	/** Points the `build` and `watch` scripts of `package.json` at `place`, since the root has no single folder for `rbxtsc` to compile. */
	scripts(place: string): PlannedCommand {
		const settings = [
			`scripts.build=rbxtsc -p ${place}`,
			`scripts.watch=rbxtsc -w -p ${place}`,
		];
		return {
			command: `npm pkg set ${settings.map((setting) => `"${setting}"`).join(" ")}`,
			file: "npm",
			args: ["pkg", "set", ...settings],
			timeout: SCRIPT_TIMEOUT,
		};
	}

	/** The `tsconfig.json` of the common code of several places, which the editor reads to check it and `rbxtsc` never does, and of the first place, which compiles its own code with the common code. */
	placesTsconfigs(): PlannedFile[] {
		return [...templateFiles(PLACES_VARIANT)]
			.filter(([file]) => file.endsWith("/tsconfig.json"))
			.map(([fileName, content]) => ({ fileName, content }));
	}
}
