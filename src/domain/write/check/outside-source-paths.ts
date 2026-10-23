import path from "path";
import { containsPosix, toPosix } from "../../../base/path.js";
import { closestMatch } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";

/** Files named to `check` that no config reads, when their folder looks like a source path with a typo in it. */
export class OutsideSourcePaths {
	/** `sourcePaths` are absolute POSIX paths, every one of every config that was asked. */
	constructor(private readonly sourcePaths: readonly string[]) {}

	/** A warning for `file` when its first folder below a source path's parent is one edit from that source path's name. */
	about(file: string): Diagnostic[] {
		const posix = toPosix(file);
		for (const sourcePath of this.sourcePaths.map(toPosix)) {
			const parent = path.posix.dirname(sourcePath);
			const name = path.posix.basename(sourcePath);
			if (!containsPosix(parent, posix) || posix === parent) continue;
			const [folder] = path.posix.relative(parent, posix).split("/");
			if (folder === name) continue;
			if (folder.toLowerCase() === name.toLowerCase())
				return [
					warningDiagnostic(
						"scan.outsideSourcePaths",
						{ resource: file },
						`this path is in no source path, so Rogen leaves it out of the project file, and "${folder}" differs from the source path "${name}" only in letter case. Check the spelling.`
					),
				];
			if (closestMatch(folder, [name]) !== name) continue;
			return [
				warningDiagnostic(
					"scan.outsideSourcePaths",
					{ resource: file },
					`this path is in no source path, so Rogen leaves it out of the project file, and "${folder}" is one edit from the source path "${name}". Check the spelling.`
				),
			];
		}
		return [];
	}
}
