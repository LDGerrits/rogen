import path from "path";
import { compareStrings } from "../../base/collections.js";
import { joinPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DirClaims, RootClaims } from "./dir-claims.js";
import { ScannedRoot } from "./root-scanner.js";

/** A directory whose markers, an init script's route suffix among them, route its folder to more than one place. */
interface MarkerClash {
	/** An absolute POSIX path. */
	readonly dir: string;
	/** The marker files and init scripts that route it, sorted. */
	readonly names: readonly string[];
}

/** The directories whose markers disagree. Markers in one directory all sit at one level, so no order could choose between two routes; claiming them in scan order would pick one silently. */
export class MarkerClashes {
	private readonly clashes: readonly MarkerClash[];

	constructor(claims: RootClaims) {
		this.clashes = claims.roots.flatMap((root) =>
			this.clashesIn(root, claims.of(root))
		);
	}

	/** The marker files and init scripts of the clashes, as absolute POSIX paths. */
	get files(): ReadonlySet<string> {
		return new Set(
			this.clashes.flatMap(({ dir, names }) =>
				names.map((name) => joinPosix(dir, name))
			)
		);
	}

	/** Two routes at one level of a folder leave nothing to decide between them. */
	diagnostics(): Diagnostic[] {
		return this.clashes.map(({ dir, names }) =>
			errorDiagnostic(
				"route.markerClash",
				{ resource: dir },
				`${joinedWithAnd(names.map((name) => `"${name}"`))} route this folder to different places, and nothing decides between them. Keep one.`
			)
		);
	}

	private clashesIn(root: ScannedRoot, dirs: DirClaims): MarkerClash[] {
		const clashes: MarkerClash[] = [];
		for (const dir of dirs.dirs()) {
			const claims = [
				...dirs.markersAt(dir).map(({ fileName, key }) => ({
					key,
					name: fileName,
				})),
				...dirs.initRoutesAt(dir).map(({ key, source }) => ({
					key,
					name: path.posix.basename(source),
				})),
			];
			if (new Set(claims.map(({ key }) => key)).size > 1)
				clashes.push({
					dir: joinPosix(root.sourcePath, dir),
					names: claims.map(({ name }) => name).sort(compareStrings),
				});
		}
		return clashes;
	}
}
