import path from "path";
import { formatJsonFile } from "../../base/json.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	configFileName,
} from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Mount, PlannedFile } from "../toolchain/toolchain.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { SAMPLE_GAME_FOLDER } from "./sample-game.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

export const PROJECTS_FOLDER = "projects";
export const COMMON_FOLDER = "common";

const SOURCE_FOLDER = DEFAULT_SOURCE_PATH;
const FIRST_PLACE = "game";
const SETTINGS_FILE = ".vscode/settings.json";

const PROJECT_SOURCE_PATHS: readonly string[] = [
	`../${COMMON_FOLDER}/${DEFAULT_SOURCE_PATH}`,
	DEFAULT_SOURCE_PATH,
];

export interface StartingPlaces {
	readonly place: string;
	readonly folder: string;
	readonly configFile: string;
	readonly projectFile: string;
	readonly outputPrefix: string;
	readonly sourcePaths: readonly string[];
	readonly commonSourcePath: string;
	readonly placeSourcePath: string;
	readonly gameFolder: string;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	readonly settings: boolean;
}

export class StarterPlaces {
	constructor(@FileSystemService private readonly files: FileSystemService) {}

	async plan(
		root: string,
		starter: RobloxTsStarter | undefined
	): Promise<StartingPlaces> {
		return starter ? this.inFolders(starter) : this.atRoot(root);
	}

	private inFolders(starter: RobloxTsStarter): StartingPlaces {
		const place = path.posix.join(PROJECTS_FOLDER, FIRST_PLACE);
		const common = path.posix.join(PROJECTS_FOLDER, COMMON_FOLDER);
		const commonSourcePath = path.posix.join(common, DEFAULT_SOURCE_PATH);
		const placeSourcePath = path.posix.join(place, DEFAULT_SOURCE_PATH);
		return {
			place,
			folder: place,
			configFile: path.posix.join(place, DEFAULT_CONFIG_FILE),
			projectFile: path.posix.join(place, DEFAULT_PROJECT_FILE),
			outputPrefix: "",
			sourcePaths: PROJECT_SOURCE_PATHS,
			commonSourcePath,
			placeSourcePath,
			gameFolder: SAMPLE_GAME_FOLDER,
			files: starter.placesTsconfigs(),
			directories: [commonSourcePath, placeSourcePath],
			notes: [],
			settings: false,
		};
	}

	private async atRoot(root: string): Promise<StartingPlaces> {
		const commonSourcePath = path.posix.join(SOURCE_FOLDER, COMMON_FOLDER);
		const placeSourcePath = path.posix.join(SOURCE_FOLDER, FIRST_PLACE);
		const command = StarterPlaces.sourcemapCommand(FIRST_PLACE);
		const present = await this.files.exists(path.join(root, SETTINGS_FILE));
		return {
			place: FIRST_PLACE,
			folder: "",
			configFile: configFileName(FIRST_PLACE),
			projectFile: projectFileName(FIRST_PLACE),
			outputPrefix: `${FIRST_PLACE}.`,
			sourcePaths: [commonSourcePath, placeSourcePath],
			commonSourcePath,
			placeSourcePath,
			gameFolder: path.posix.join(SAMPLE_GAME_FOLDER, FIRST_PLACE),
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
			directories: [commonSourcePath, placeSourcePath],
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

	static mountsFor(
		places: StartingPlaces,
		mounts: readonly Mount[],
		own: readonly string[]
	): Mount[] {
		if (places.folder === "") return [...mounts];
		return mounts.map((mount) => ({
			...mount,
			optional: true,
			path: own.includes(mount.path)
				? mount.path
				: path.posix.relative(places.folder, mount.path),
		}));
	}
}
