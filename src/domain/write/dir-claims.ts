import { dirnamePosix, joinPosix } from "../../base/path.js";
import { NameReadings } from "./name-readings.js";
import { ScannedRoot } from "./root-scanner.js";

interface FolderMarker {
	readonly fileName: string;
	readonly key: string;
}

/** What the marker files of one source path's folders offer to claim, by folder relative to the source path. */
export class DirClaims {
	private readonly markers: ReadonlyMap<string, string[]>;
	/** By folder: the part after `init` of the name of its init script, or none when an init script there routes itself. */
	private readonly initExtensions = new Map<string, string | undefined>();

	constructor(
		private readonly root: ScannedRoot,
		private readonly readings: NameReadings
	) {
		this.markers = root.markersByDir();
		for (const entry of root.entries) {
			const read = readings.entryReading(entry.source);
			if (!read.isInit || read.kind !== "script") continue;
			const dir = dirnamePosix(entry.relativePath);
			const folder = dir === "." ? "" : dir;
			const routesItself = read.match.spans.length > 0;
			if (routesItself) this.initExtensions.set(folder, undefined);
			else if (!this.initExtensions.has(folder))
				this.initExtensions.set(
					folder,
					read.fileName.slice(read.fileName.indexOf("."))
				);
		}
	}

	/** What a pattern reads after the name of the folder at `dir` for the instance its init script makes, such as `.luau`; none without an init script, or when one routes itself. */
	initExtensionAt(dir: string): string | undefined {
		return this.initExtensions.get(dir);
	}

	dirs(): Set<string> {
		return new Set(this.markers.keys());
	}

	markersAt(dir: string): FolderMarker[] {
		return (this.markers.get(dir) ?? []).flatMap((fileName) => {
			const key = this.readings.markers.get(
				joinPosix(this.root.sourcePath, dir, fileName)
			)?.key;
			return key === undefined ? [] : [{ fileName, key }];
		});
	}
}

/** The claims of every source path, built once for the routing and the checks. */
export class RootClaims {
	private readonly byRoot = new Map<ScannedRoot, DirClaims>();

	constructor(
		readonly roots: readonly ScannedRoot[],
		readings: NameReadings
	) {
		for (const root of roots)
			this.byRoot.set(root, new DirClaims(root, readings));
	}

	of(root: ScannedRoot): DirClaims {
		const claims = this.byRoot.get(root);
		if (!claims) throw new Error(`${root.sourcePath} was not scanned.`);
		return claims;
	}
}
