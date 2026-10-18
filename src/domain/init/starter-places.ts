import path from "path";
import { FileReader } from "../../platform/fs/file-system-service.js";
import {
	CONFIG_FILE_NAMES,
	DEFAULT_SOURCE_PATH,
	RogenConfig,
	configFileContent,
} from "../config/config.js";
import { PlaceFinder } from "../config/place-finder.js";
import { PlannedFile } from "../toolchain/toolchain.js";
import { KnownPlaces } from "./known-places.js";
import { WorkspaceFiles } from "./workspace-files.js";

/** Where the places of a new project start. */
const PLACES_FOLDER = "places";
const SHARED = "shared";
const FIRST_PLACE = "game";

export interface StartingPlaces {
	/** The source path of the code the places share, which the root config lists. */
	readonly sharedSourcePath: string;
	/** The folder of the first place. */
	readonly place: string;
	readonly placePaths: readonly string[];
	/** The first place's source path, relative to the project. */
	readonly placeSourcePath: string;
	readonly files: readonly PlannedFile[];
	readonly directories: readonly string[];
	readonly notes: readonly string[];
}

/** The places a project of several starts with: the code they share, and the first place, as `rogen init places/<name>` plans a place. */
export class StarterPlaces {
	private readonly finder: PlaceFinder;
	private readonly workspaces: WorkspaceFiles;

	constructor(private readonly files: FileReader) {
		this.finder = new PlaceFinder(files);
		this.workspaces = new WorkspaceFiles(files);
	}

	/** `extend` adds what the first place needs beyond its config, given the folders of the place and of the shared code. */
	async plan(
		root: string,
		extend?: (
			place: string,
			shared: string
		) => { files: PlannedFile[]; config: Partial<RogenConfig> }
	): Promise<StartingPlaces> {
		const sharedSourcePath = path.posix.join(
			PLACES_FOLDER,
			SHARED,
			DEFAULT_SOURCE_PATH
		);
		const place = path.posix.join(PLACES_FOLDER, FIRST_PLACE);
		const placePaths = [path.posix.join(PLACES_FOLDER, "*")];
		const known = await KnownPlaces.of(
			this.files,
			this.finder,
			root,
			placePaths,
			[sharedSourcePath]
		);
		const port = known.portFor(path.join(root, place));
		const workspace = await this.workspaces.plan(
			root,
			known.foldersWith(root, path.join(root, place)),
			place
		);
		const placeSourcePath = path.posix.join(place, DEFAULT_SOURCE_PATH);
		const configFile = path.posix.join(place, CONFIG_FILE_NAMES[0]);
		const extra = extend?.(place, sharedSourcePath);
		return {
			sharedSourcePath,
			place,
			placePaths,
			placeSourcePath,
			files: [
				{
					fileName: configFile,
					content: configFileContent({
						...extra?.config,
						servePort: port,
					}),
				},
				...(extra?.files ?? []),
				...workspace.files,
			],
			directories: [placeSourcePath],
			notes: [
				KnownPlaces.pinNote(FIRST_PLACE, port, configFile),
				...workspace.notes,
			],
		};
	}
}
