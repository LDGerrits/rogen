import path from "path";
import { compareStrings } from "../../base/collections.js";
import { parse } from "../../base/jsonc.js";
import { isObject } from "../../base/objects.js";
import { toPosix } from "../../base/path.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { PlaceFinder } from "../config/place-finder.js";
import { PlacePorts } from "../config/place-ports.js";

interface KnownPlace {
	readonly directory: string;
	readonly pinned: number | undefined;
}

/** The places a config lists already, and the ports they are served on. */
export class KnownPlaces {
	private constructor(private readonly places: readonly KnownPlace[]) {}

	static async of(
		files: FileReader,
		finder: PlaceFinder,
		root: string,
		placePaths: readonly string[],
		sourcePaths: readonly string[]
	): Promise<KnownPlaces> {
		const folders = await finder.folders(root, placePaths, sourcePaths);
		return new KnownPlaces(
			await Promise.all(
				folders.map(async (directory) => {
					const file = await finder.configIn(directory);
					const parsed = file
						? parse(await files.readFile(file))
						: undefined;
					return {
						directory,
						pinned:
							parsed?.isOk() && isObject(parsed.value)
								? PlacePorts.pinnedBy(parsed.value.servePort)
								: undefined,
					};
				})
			)
		);
	}

	/** The folders of the places under `root`, as relative paths, with `folder` among them, sorted: what a workspace file lists. */
	foldersWith(root: string, folder: string): string[] {
		return [
			...new Set(
				[...this.directories, folder].map((directory) =>
					toPosix(path.relative(root, directory))
				)
			),
		].sort(compareStrings);
	}

	/** What `init` says of the port it pinned for a place. */
	static pinNote(name: string, port: number, configFile: string): string {
		return `${name} is served on port ${port}, which its ${configFile} pins so adding another place never moves it.`;
	}

	get directories(): string[] {
		return this.places.map(({ directory }) => directory);
	}

	/** The port to pin for a place at `folder`: the first that no other place is served on, however it got it. */
	portFor(folder: string): number {
		const pinned = this.places
			.filter(({ directory }) => toPosix(directory) !== toPosix(folder))
			.sort((a, b) =>
				compareStrings(toPosix(a.directory), toPosix(b.directory))
			)
			.map(({ pinned }) => pinned);
		const taken = new Set([
			...pinned.filter((port) => port !== undefined),
			...PlacePorts.assign(pinned).filter((port) => port !== undefined),
		]);
		return PlacePorts.firstFree(taken);
	}
}
