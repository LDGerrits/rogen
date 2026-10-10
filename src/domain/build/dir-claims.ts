import { dirnamePosix, joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/config.js";
import { NameReadings } from "./name-readings.js";
import { ScannedRoot } from "./root-scanner.js";

/** The route an init script's suffix gives the folder it sits in, whether it's spelled `@key`, and the script's variants. */
export interface InitRoute {
	readonly key: string;
	readonly source: string;
	readonly at: boolean;
	/** In the order the name spells them. */
	readonly variants: readonly string[];
}

/** A marker file in a folder, with the declared key it spells. */
export interface FolderMarker {
	readonly fileName: string;
	readonly key: string;
}

/** What the markers and init scripts of one root dir's folders offer to claim, by folder relative to the root dir. */
export class DirClaims {
	private readonly markers: ReadonlyMap<string, string[]>;
	private readonly initRoutes: ReadonlyMap<string, readonly InitRoute[]>;

	constructor(
		private readonly root: ScannedRoot,
		private readonly readings: NameReadings,
		private readonly keys: DeclaredKeys
	) {
		this.markers = root.markersByDir();
		this.initRoutes = this.initRoutesOf();
	}

	/** Every folder that holds a marker or an init script that routes. */
	dirs(): Set<string> {
		return new Set([...this.markers.keys(), ...this.initRoutes.keys()]);
	}

	/** The markers of `dir` that spell a declared key. */
	markersAt(dir: string): FolderMarker[] {
		return (this.markers.get(dir) ?? []).flatMap((fileName) => {
			const key = this.readings.markers.get(
				joinPosix(this.root.rootDir, dir, fileName)
			)?.key;
			return key === undefined ? [] : [{ fileName, key }];
		});
	}

	/** The routes the init scripts of `dir` give it. */
	initRoutesAt(dir: string): readonly InitRoute[] {
		return this.initRoutes.get(dir) ?? [];
	}

	/** Whether a route outranks the markers and init scripts of `dir`: its own name's, or a folder's, marker's or init script's above it. */
	isRoutedAbove(dir: string): boolean {
		const segments = dir.split("/");
		return segments.some((_, index) => {
			const at = segments.slice(0, index + 1).join("/");
			const above = segments.slice(0, index).join("/");
			return (
				this.readings.folders.get(joinPosix(this.root.rootDir, at))
					?.route !== undefined ||
				this.initRoutesAt(above).length > 0 ||
				this.markersAt(above).some(({ key }) => this.keys.isRoute(key))
			);
		});
	}

	/** The routes each folder's init scripts give it, whichever variants are on, so turning one on never moves the files beside it. */
	private initRoutesOf(): Map<string, InitRoute[]> {
		const routes = new Map<string, InitRoute[]>();
		for (const entry of this.root.entries) {
			const read = this.readings.entryReading(entry.source);
			if (!read.isInit) continue;
			const { stem, match } = read;
			// Only the last `@key` of a name routes; the ones before it are outranked.
			const governing = match.spans.find(({ key }) =>
				this.keys.isRoute(key)
			);
			if (!governing) continue;
			const dir = dirnamePosix(entry.relativePath);
			routes.set(dir, [
				...(routes.get(dir) ?? []),
				{
					key: governing.key,
					source: entry.source,
					at: stem[governing.start] === "@",
					variants: match.spans
						.filter(({ key }) => this.keys.isVariant(key))
						.map(({ key }) => key)
						.reverse(),
				},
			]);
		}
		return routes;
	}
}
