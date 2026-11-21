import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { PlannedCommand, PlannedScaffold } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const CREATE_TIMEOUT = 300_000;
const SCRIPT_TIMEOUT = 60_000;

const OUT_DIR = "out";

const PLACES_VARIANT = "roblox-ts-places";

export class RobloxTsStarter {
	static readonly OWN_FOLDERS: readonly string[] = ["include"];

	static of(language: Language): RobloxTsStarter | undefined {
		return language.id === "roblox-ts" ? new RobloxTsStarter() : undefined;
	}

	static ignored(several: boolean, outDir = OUT_DIR): string[] {
		return [
			"/node_modules",
			`/${outDir}`,
			"/include",
			"*.tsbuildinfo",
			...(several ? [`projects/*/${outDir}`, "projects/*/include"] : []),
		];
	}

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

	placesTsconfigs(): PlannedFile[] {
		return [...templateFiles(PLACES_VARIANT)]
			.filter(([file]) => file.endsWith("/tsconfig.json"))
			.map(([fileName, content]) => ({ fileName, content }));
	}
}
