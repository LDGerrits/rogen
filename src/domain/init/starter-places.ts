import path from "path";
import { formatJsonFile } from "../../base/json.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
} from "../config/config.js";
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
		const commonFolder = path.posix.join(PLACES_FOLDER, COMMON_FOLDER);
		const placeFolder = path.posix.join(PLACES_FOLDER, FIRST_PLACE);
		const commonSourcePath = path.posix.join(commonFolder, SOURCE_FOLDER);
		const placeSourcePath = path.posix.join(placeFolder, SOURCE_FOLDER);
		const compiler = starter ? language.compiler : undefined;
		const editor =
			starter && compiler
				? {
						files: starter.placesTsconfigs(),
						notes: [],
						workspaceFile: "",
					}
				: await this.workspace(root, commonFolder, placeFolder);
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
			...(compiler && {
				compiledPath: path.posix.join(compiler.outDir, FIRST_PLACE),
			}),
			directories: [commonSourcePath, placeSourcePath],
			...editor,
		};
	}

	private async workspace(
		root: string,
		commonFolder: string,
		placeFolder: string
	): Promise<Pick<StartingPlaces, "files" | "notes" | "workspaceFile">> {
		const workspaceFile = `${path.basename(root)}${WORKSPACE_EXTENSION}`;
		const folders = [commonFolder, placeFolder];
		const settings = StarterPlaces.workspaceSettings();
		const present = await this.files.exists(path.join(root, workspaceFile));
		return {
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
			notes: present
				? [
						`${workspaceFile} is there already: add ${folders.map((folder) => `"${folder}"`).join(" and ")} to its folders, and ${JSON.stringify(settings)} to its settings.`,
					]
				: [],
			workspaceFile,
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
