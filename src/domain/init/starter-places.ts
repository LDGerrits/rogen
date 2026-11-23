import path from "path";
import { formatJsonFile } from "../../base/json.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	configFileName,
} from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export const COMMON_FOLDER = "common";
export const PLACES_FOLDER = "projects";

const SOURCE_FOLDER = DEFAULT_SOURCE_PATH;
const FIRST_PLACE = "game";
const SETTINGS_FILE = ".vscode/settings.json";
const WORKSPACE_EXTENSION = ".code-workspace";

export interface StartingPlaces {
	readonly place: string;
	readonly target: string;
	readonly configFile: string;
	readonly projectFile: string;
	readonly configFolder: string;
	readonly outputPrefix: string;
	readonly sourcePaths: readonly string[];
	readonly commonSourcePath: string;
	readonly placeSourcePath: string;
	readonly compiledPath?: string;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	readonly workspaceFile: string;
}

export class StarterPlaces {
	constructor(@FileSystemService private readonly files: FileSystemService) {}

	async plan(
		root: string,
		language: Language,
		starter: RobloxTsStarter | undefined
	): Promise<StartingPlaces> {
		if (starter && language.compiler)
			return StarterPlaces.compiled(language, starter);
		const commonFolder = path.posix.join(PLACES_FOLDER, COMMON_FOLDER);
		const placeFolder = path.posix.join(PLACES_FOLDER, FIRST_PLACE);
		const commonSourcePath = path.posix.join(commonFolder, SOURCE_FOLDER);
		const placeSourcePath = path.posix.join(placeFolder, SOURCE_FOLDER);
		const workspaceFile = `${path.basename(root)}${WORKSPACE_EXTENSION}`;
		const folders = [commonFolder, placeFolder];
		const settings = StarterPlaces.workspaceSettings();
		const present = await this.files.exists(path.join(root, workspaceFile));
		return {
			place: FIRST_PLACE,
			target: placeFolder,
			configFile: path.posix.join(placeFolder, DEFAULT_CONFIG_FILE),
			projectFile: path.posix.join(placeFolder, DEFAULT_PROJECT_FILE),
			configFolder: placeFolder,
			outputPrefix: "",
			sourcePaths: [
				path.posix.relative(placeFolder, commonSourcePath),
				SOURCE_FOLDER,
			],
			commonSourcePath,
			placeSourcePath,
			files: [
				...(present
					? []
					: [
							{
								fileName: workspaceFile,
								content: formatJsonFile({
									folders: folders.map((folder) => ({
										path: folder,
									})),
									settings,
								}),
							},
						]),
				{
					fileName: path.posix.join(commonFolder, SETTINGS_FILE),
					content: formatJsonFile({
						"luau-lsp.sourcemap.generatorCommand": `rogen sourcemap ../${FIRST_PLACE} --watch -o sourcemap.json`,
					}),
				},
			],
			directories: [commonSourcePath, placeSourcePath],
			notes: present
				? [
						`${workspaceFile} is there already: add ${folders.map((folder) => `"${folder}"`).join(" and ")} to its folders, and ${JSON.stringify(settings)} to its settings.`,
					]
				: [],
			workspaceFile,
		};
	}

	private static compiled(
		language: Language,
		starter: RobloxTsStarter
	): StartingPlaces {
		const commonSourcePath = path.posix.join(SOURCE_FOLDER, COMMON_FOLDER);
		const placeSourcePath = path.posix.join(SOURCE_FOLDER, FIRST_PLACE);
		return {
			place: FIRST_PLACE,
			target: FIRST_PLACE,
			configFile: configFileName(FIRST_PLACE),
			projectFile: projectFileName(FIRST_PLACE),
			configFolder: "",
			outputPrefix: `${FIRST_PLACE}.`,
			sourcePaths: [commonSourcePath, placeSourcePath],
			commonSourcePath,
			placeSourcePath,
			compiledPath: path.posix.join(
				language.compiler!.outDir,
				FIRST_PLACE
			),
			files: starter.placesTsconfigs(),
			directories: [commonSourcePath, placeSourcePath],
			notes: [],
			workspaceFile: "",
		};
	}

	private static workspaceSettings(): Record<string, string | boolean> {
		return {
			"luau-lsp.sourcemap.enabled": true,
			"luau-lsp.sourcemap.autogenerate": true,
			"luau-lsp.sourcemap.sourcemapFile": "sourcemap.json",
			"luau-lsp.sourcemap.generatorCommand":
				"rogen sourcemap --watch -o sourcemap.json",
			"stylua.searchParentDirectories": true,
		};
	}
}
