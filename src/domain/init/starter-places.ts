import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	DEFAULT_SOURCE_PATH,
	configFileName,
} from "../config/config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Mount, PlannedFile } from "../toolchain/toolchain.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";

/** Where the places of a compiled project start: the folder that holds them, the code they share and the first one. */
export const PROJECTS_FOLDER = "projects";
export const COMMON_FOLDER = "common";

/** Where the places of a Luau project keep their code: the code they share, and each place's own below `src`. */
const SOURCE_FOLDER = DEFAULT_SOURCE_PATH;
const FIRST_PLACE = "game";
const SETTINGS_FILE = ".vscode/settings.json";

/** The source paths of a place in `projects`, as every place lists them: the common code, then its own. */
export const PROJECT_SOURCE_PATHS: readonly string[] = [
	`../${COMMON_FOLDER}/${DEFAULT_SOURCE_PATH}`,
	DEFAULT_SOURCE_PATH,
];

export interface StartingPlaces {
	/** The first place as `serve` and `build` take it: its name, or its folder in `projects`. */
	readonly place: string;
	/** The folder the place's own files are in, relative to the project; empty when they are at its root. */
	readonly folder: string;
	/** The place's config and the project file it writes, relative to the project. */
	readonly configFile: string;
	readonly projectFile: string;
	/** What the stem of the place's other configs, such as `dist`, starts with. */
	readonly outputPrefix: string;
	/** The source paths the place lists. */
	readonly sourcePaths: readonly string[];
	/** The source path of the code the places share. */
	readonly commonSourcePath: string;
	/** The first place's source path, relative to the project. */
	readonly placeSourcePath: string;
	/** The editor settings of a Luau project and the tsconfig files of a compiled one. */
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	/** Whether the editor settings written for the place keep luau-lsp's sourcemap current. */
	readonly settings: boolean;
}

/** The places a project of several starts with: the code they share, and the first place. A compiled project keeps each place in a folder of `projects`, and a Luau one has a config per place at its root. */
export class StarterPlaces {
	constructor(private readonly files: FileReader) {}

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
			files: [
				starter.commonTsconfig(commonSourcePath),
				...starter.place(place, commonSourcePath).files,
			],
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

	/** The command luau-lsp runs to keep `sourcemap.json` current for `place`. */
	static sourcemapCommand(place: string): string {
		return `rogen sourcemap ${place} --watch -o sourcemap.json`;
	}

	/** `mounts` of a project's root as a place reads them; `own` are the folders the place has itself, such as roblox-ts's `include`. All are optional, as a place is not compiled yet. A place at the root reads them as they are. */
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
