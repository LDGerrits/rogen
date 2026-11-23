import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { DEFAULT_SOURCE_PATH, configFileName } from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export const COMMON_FOLDER = "common";

const SOURCE_FOLDER = DEFAULT_SOURCE_PATH;
const FIRST_PLACE = "lobby";
const SETTINGS_FILE = ".vscode/settings.json";

export interface StartingPlaces {
	readonly place: string;
	readonly configFile: string;
	readonly projectFile: string;
	readonly outputPrefix: string;
	readonly sourcePaths: readonly string[];
	readonly commonSourcePath: string;
	readonly placeSourcePath: string;
	readonly compiledPath?: string;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	readonly settings: boolean;
}

export class StarterPlaces {
	constructor(@FileSystemService private readonly files: FileSystemService) {}

	async plan(
		root: string,
		language: Language,
		starter: RobloxTsStarter | undefined
	): Promise<StartingPlaces> {
		const commonSourcePath = path.posix.join(SOURCE_FOLDER, COMMON_FOLDER);
		const placeSourcePath = path.posix.join(SOURCE_FOLDER, FIRST_PLACE);
		const shared = {
			place: FIRST_PLACE,
			configFile: configFileName(FIRST_PLACE),
			projectFile: projectFileName(FIRST_PLACE),
			outputPrefix: `${FIRST_PLACE}.`,
			sourcePaths: [commonSourcePath, placeSourcePath],
			commonSourcePath,
			placeSourcePath,
			directories: [commonSourcePath, placeSourcePath],
		};
		if (starter && language.compiler)
			return {
				...shared,
				compiledPath: path.posix.join(
					language.compiler.outDir,
					FIRST_PLACE
				),
				files: starter.placesTsconfigs(),
				notes: [],
				settings: false,
			};
		const command = StarterPlaces.sourcemapCommand(FIRST_PLACE);
		const present = await this.files.exists(path.join(root, SETTINGS_FILE));
		return {
			...shared,
			files: [
				{
					fileName: SETTINGS_FILE,
					content: formatJsonFile({
						"luau-lsp.sourcemap.enabled": true,
						"luau-lsp.sourcemap.autogenerate": true,
						"luau-lsp.sourcemap.sourcemapFile": "sourcemap.json",
						"luau-lsp.sourcemap.generatorCommand": command,
					}),
				},
			],
			notes: present
				? [
						`${SETTINGS_FILE} is there already: set "luau-lsp.sourcemap.generatorCommand" in it to "${command}", so luau-lsp reads the sourcemap of the ${FIRST_PLACE} place.`,
					]
				: [],
			settings: true,
		};
	}

	static sourcemapCommand(place: string): string {
		return `rogen sourcemap ${place} --watch -o sourcemap.json`;
	}
}
