import { ErrorUtils } from "../../base/errors.js";
import { stableStringify } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoTree } from "../rojo/rojo-tree.js";
import { OutputDiagnostics } from "./output-diagnostics.js";
import { OutputService, OutputWriteResult } from "./output-service.js";
import { stagingFile } from "./staging-file.js";

export class CoreOutputService implements OutputService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly fileSystemService: FileSystemService) {}

	async write(
		config: Pick<ResolvedConfig, "outFile">,
		tree: RojoTree
	): Promise<Result<OutputWriteResult, Diagnostic[]>> {
		const { outFile } = config;
		const content = `${stableStringify(tree)}\n`;
		const temporary = stagingFile(outFile);

		try {
			if (
				(await this.fileSystemService.isFile(outFile)) &&
				(await this.fileSystemService.readFile(outFile)) === content
			) {
				return ok({ written: false });
			}
			await this.fileSystemService.writeFile(temporary, content);
			await this.fileSystemService.rename(temporary, outFile, true);
			return ok({ written: true });
		} catch (error) {
			await this.fileSystemService
				.delete(temporary)
				.catch(() => undefined);
			return err([
				OutputDiagnostics.writeFailed(
					{ resource: outFile },
					ErrorUtils.fromUnknown(error).message
				),
			]);
		}
	}
}
