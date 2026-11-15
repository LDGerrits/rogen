import { joinPosix } from "../../base/path.js";
import { NameReadings } from "./name-readings.js";
import { ScannedRoot } from "./root-scanner.js";

interface FolderMarker {
	readonly fileName: string;
	readonly key: string;
}

/** What the marker files of one source path's folders offer to claim, by folder relative to the source path. */
export class DirClaims {
	private readonly markers: ReadonlyMap<string, string[]>;

	constructor(
		private readonly root: ScannedRoot,
		private readonly readings: NameReadings
	) {
		this.markers = root.markersByDir();
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
