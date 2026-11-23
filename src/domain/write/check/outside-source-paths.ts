import path from "path";
import { containsPosix, toPosix } from "../../../base/path.js";
import { closestMatch } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";

export class OutsideSourcePaths {
	constructor(private readonly sourcePaths: readonly string[]) {}

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
						`this path is in no source path, and "${folder}" differs from "${name}" only in letter case. Check the spelling.`
					),
				];
			if (closestMatch(folder, [name]) !== name) continue;
			return [
				warningDiagnostic(
					"scan.outsideSourcePaths",
					{ resource: file },
					`this path is in no source path, and "${folder}" is one edit from "${name}". Check the spelling.`
				),
			];
		}
		return [];
	}
}
