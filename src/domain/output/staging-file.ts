import { toPosix } from "../../base/path.js";
import { generateUuid } from "../../base/uuid.js";

/** A fresh file to stage a write of `outFile` through, so concurrent writers never share one. */
export function stagingFile(outFile: string): string {
	return `${outFile}.${generateUuid()}.tmp`;
}

/** Matches the staging file of any writer of `outFile`, in posix form. */
export function stagingPattern(outFile: string): RegExp {
	const escaped = toPosix(outFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
}
