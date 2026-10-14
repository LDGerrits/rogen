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

interface MarkerClash {
	readonly dir: string;
	readonly names: readonly string[];
}

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
