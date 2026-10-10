import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { InitPlan, InitWritten } from "./init-service.js";

/** Puts the files and directories of an `init` plan on disk. */
export class InitWriter {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Writes the plan's files, then creates its directories that don't exist yet, calling `onWritten` after each and stopping at the first that fails. */
	async write(
		plan: InitPlan,
		onWritten: (written: InitWritten) => void
	): Promise<Result<void, Error>> {
		for (const file of plan.files) {
			const { fileName, content } = file;
			const written = await tryWithAsync(() =>
				this.fileSystemService.writeFile(
					path.join(plan.directory, fileName),
					content
				)
			);
			if (written.isErr()) {
				return err(
					ErrorUtils.wrap(
						`Failed to write ${fileName}`,
						written.error
					)
				);
			}
			onWritten({ kind: "file", file });
		}
		for (const directory of plan.directories) {
			const created = await tryWithAsync(async () => {
				const target = path.join(plan.directory, directory);
				if (await this.fileSystemService.exists(target)) return false;
				await this.fileSystemService.createDirectory(target);
				return true;
			});
			if (created.isErr()) {
				return err(
					ErrorUtils.wrap(
						`Failed to create ${directory}`,
						created.error
					)
				);
			}
			if (created.value) onWritten({ kind: "directory", directory });
		}
		return ok(undefined);
	}
}
