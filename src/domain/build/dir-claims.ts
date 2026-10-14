import { dirnamePosix, joinPosix } from "../../base/path.js";
import { NameReadings } from "./name-readings.js";
import { ScannedRoot } from "./root-scanner.js";

interface InitRoute {
	readonly key: string;
	readonly source: string;
	readonly at: boolean;
}

interface FolderMarker {
	readonly fileName: string;
	readonly key: string;
}

/** What the markers and init scripts of one source path's folders offer to claim, by folder relative to the source path. */
export class DirClaims {
	private readonly markers: ReadonlyMap<string, string[]>;
	private readonly initRoutes: ReadonlyMap<string, readonly InitRoute[]>;

	constructor(
		private readonly root: ScannedRoot,
		private readonly readings: NameReadings
	) {
		this.markers = root.markersByDir();
		this.initRoutes = this.initRoutesOf();
	}

	dirs(): Set<string> {
		return new Set([...this.markers.keys(), ...this.initRoutes.keys()]);
	}

	markersAt(dir: string): FolderMarker[] {
		return (this.markers.get(dir) ?? []).flatMap((fileName) => {
			const key = this.readings.markers.get(
				joinPosix(this.root.sourcePath, dir, fileName)
			)?.key;
			return key === undefined ? [] : [{ fileName, key }];
		});
	}

	initRoutesAt(dir: string): readonly InitRoute[] {
		return this.initRoutes.get(dir) ?? [];
	}

	private initRoutesOf(): Map<string, InitRoute[]> {
		const routes = new Map<string, InitRoute[]>();
		for (const entry of this.root.entries) {
			const read = this.readings.entryReading(entry.source);
			if (!read.isInit) continue;
			const { stem, match } = read;
			const [governing] = match.spans;
			if (!governing) continue;
			const dir = dirnamePosix(entry.relativePath);
			routes.set(dir, [
				...(routes.get(dir) ?? []),
				{
					key: governing.key,
					source: entry.source,
					at: stem[governing.start] === "@",
				},
			]);
		}
		return routes;
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
