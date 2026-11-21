import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { PlannedCommand, PlannedScaffold } from "./init-service.js";
import { templateFiles } from "./template-files.js";

const CREATE_TIMEOUT = 300_000;
const SCRIPT_TIMEOUT = 60_000;

const OUT_DIR = "out";

const PLACES_VARIANT = "roblox-ts-places";

export class RobloxTsStarter {
	static of(language: Language): RobloxTsStarter | undefined {
		return language.id === "roblox-ts" ? new RobloxTsStarter() : undefined;
	}

	static ignored(outDir = OUT_DIR): string[] {
		return ["/node_modules", `/${outDir}`, "/include", "*.tsbuildinfo"];
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
		const tsconfig = RobloxTsStarter.placeTsconfig(place);
		const settings = [
			`scripts.build=rbxtsc -p ${tsconfig}`,
			`scripts.watch=rbxtsc -w -p ${tsconfig}`,
		];
		return {
			command: `npm pkg set ${settings.map((setting) => `"${setting}"`).join(" ")}`,
			file: "npm",
			args: ["pkg", "set", ...settings],
			timeout: SCRIPT_TIMEOUT,
		};
	}

	static placeTsconfig(place: string): string {
		return `tsconfig.${place}.json`;
	}

	placesTsconfigs(): PlannedFile[] {
		return [...templateFiles(PLACES_VARIANT)]
			.filter(([file]) => /^tsconfig(\.[^/]+)?\.json$/.test(file))
			.map(([fileName, content]) => ({ fileName, content }));
	}
}
