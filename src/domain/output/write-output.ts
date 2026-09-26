import { randomUUID } from "crypto";
import { ErrorUtils } from "../../base/errors.js";
import { stableStringify } from "../../base/json.js";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { OutputDiagnostics } from "./output-diagnostics.js";

export interface WriteOutputResult {
	readonly value: { readonly written: boolean };
	readonly warnings: readonly Diagnostic[];
}

/** A fresh file for `writeOutput` to stage a write through, so concurrent writers never share one. */
export function stagingFile(outFile: string): string {
	return `${outFile}.${randomUUID()}.tmp`;
}

/** Matches the staging file of any writer of `outFile`, in posix form. */
export function stagingPattern(outFile: string): RegExp {
	const escaped = toPosix(outFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}\\.[^/]+\\.tmp$`);
}

/** Leaves the file untouched when its bytes wouldn't change, so Rojo doesn't re-sync and `watch` doesn't rebuild on its own write. */
export async function writeOutput(
	fileSystem: FileSystemService,
	config: Pick<ResolvedConfig, "outFile">,
	tree: RojoTree
): Promise<Result<WriteOutputResult, Diagnostic[]>> {
	const { outFile } = config;
	const content = `${stableStringify(tree)}\n`;
	const temporary = stagingFile(outFile);

	try {
		if (
			(await fileSystem.isFile(outFile)) &&
			(await fileSystem.readFile(outFile)) === content
		) {
			return ok({ value: { written: false }, warnings: [] });
		}
		await fileSystem.writeFile(temporary, content);
		await fileSystem.rename(temporary, outFile, true);
		return ok({ value: { written: true }, warnings: [] });
	} catch (error) {
		await fileSystem.delete(temporary).catch(() => undefined);
		return err([
			OutputDiagnostics.writeFailed(
				{ resource: outFile },
				ErrorUtils.fromUnknown(error).message
			),
		]);
	}
}
