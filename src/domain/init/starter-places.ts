import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { DEFAULT_SOURCE_PATH, RogenConfig } from "../config/config.js";
import { Mount, PlannedFile } from "../toolchain/toolchain.js";
import { RobloxTsStarter } from "./roblox-ts-starter.js";
import { WorkspaceFiles } from "./workspace-files.js";

/** Where the places of a project start: the folder that holds them, the code they share and the first one. */
export const PLACES_FOLDER = "places";
export const SHARED_FOLDER = "shared";
const FIRST_PLACE = "game";

/** The source paths of a place, as every place lists them: the shared code, then its own. */
export const PLACE_SOURCE_PATHS: readonly string[] = [
	`../${SHARED_FOLDER}/${DEFAULT_SOURCE_PATH}`,
	DEFAULT_SOURCE_PATH,
];

export interface StartingPlaces {
	/** The folder of the first place. */
	readonly place: string;
	/** The source path of the code the places share. */
	readonly sharedSourcePath: string;
	/** The first place's source path, relative to the project. */
	readonly placeSourcePath: string;
	/** The editor workspace and, for roblox-ts, the tsconfig files. */
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
	/** The workspace file made for the places, when there was none. */
	readonly workspace?: string;
}

/** The places a project of several starts with: the code they share, and the first place. */
export class StarterPlaces {
	private readonly workspaces: WorkspaceFiles;

	constructor(files: FileReader) {
		this.workspaces = new WorkspaceFiles(files);
	}

	async plan(
		root: string,
		starter: RobloxTsStarter | undefined
	): Promise<StartingPlaces> {
		const place = path.posix.join(PLACES_FOLDER, FIRST_PLACE);
		const shared = path.posix.join(PLACES_FOLDER, SHARED_FOLDER);
		const sharedSourcePath = path.posix.join(shared, DEFAULT_SOURCE_PATH);
		const placeSourcePath = path.posix.join(place, DEFAULT_SOURCE_PATH);
		const workspace = await this.workspaces.planAll(root, [place, shared]);
		return {
			place,
			sharedSourcePath,
			placeSourcePath,
			files: [
				...workspace.files,
				...(starter
					? [
							starter.sharedTsconfig(sharedSourcePath),
							...starter.place(place, sharedSourcePath).files,
						]
					: []),
			],
			directories: [sharedSourcePath, placeSourcePath],
			notes: workspace.notes,
			workspace: workspace.files.find(
				({ addition }) => addition === undefined
			)?.fileName,
		};
	}

	/** The config of the shared code: the places' routes, so the editor resolves instance-path requires inside it. It is never served. */
	static sharedConfig(routes: Record<string, string>): RogenConfig {
		return { tree: { $className: "DataModel" }, rogen: { routes } };
	}

	/** `mounts` of a project's root as a place at `place` reads them; `own` are the folders the place has itself, such as roblox-ts's `include`. All are optional, as a place is not compiled yet. */
	static mountsFor(
		place: string,
		mounts: readonly Mount[],
		own: readonly string[]
	): Mount[] {
		return mounts.map((mount) => ({
			...mount,
			optional: true,
			path: own.includes(mount.path)
				? mount.path
				: path.posix.relative(place, mount.path),
		}));
	}
}
