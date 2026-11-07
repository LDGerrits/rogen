import path from "path";
import { selfAndAncestors } from "../../base/path.js";
import { IoError, KindedError } from "../../base/errors.js";
import { tryWithAsync } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

type Change =
	| { readonly kind: "rename"; readonly from: string; readonly to: string }
	| { readonly kind: "created"; readonly path: string }
	| {
			readonly kind: "changed";
			readonly path: string;
			readonly earlier: string;
	  };

/** Makes init's changes to the file system and records each, so a failed run can put the folder back as it was. */
export class UndoLog {
	private readonly changes: Change[] = [];

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly directory: string
	) {}

	async rename(from: string, to: string): Promise<void> {
		await this.recordMissing(path.dirname(to));
		await this.fileSystemService.rename(from, to);
		this.changes.push({ kind: "rename", from, to });
	}

	async writeFile(file: string, content: string): Promise<void> {
		const earlier = (await this.fileSystemService.isFile(file))
			? await this.fileSystemService.readFile(file)
			: undefined;
		await this.recordMissing(path.dirname(file));
		await this.fileSystemService.writeFile(file, content);
		this.changes.push(
			earlier === undefined
				? { kind: "created", path: file }
				: { kind: "changed", path: file, earlier }
		);
	}

	/** Whether the folder was missing, and so made. */
	async createDirectory(directory: string): Promise<boolean> {
		if (await this.fileSystemService.exists(directory)) return false;
		await this.recordMissing(directory);
		return true;
	}

	/** Undoes the changes, the last first, and returns `error` naming the paths it could not put back. */
	async undo(error: Error): Promise<Error> {
		const left: string[] = [];
		for (const change of this.changes.reverse()) {
			const undone = await tryWithAsync(() => this.reverse(change));
			if (undone.isErr())
				left.push(change.kind === "rename" ? change.to : change.path);
		}
		if (left.length === 0) return error;
		const reason =
			error instanceof KindedError ? error.reason : error.message;
		return new IoError(
			`${reason.replace(/\.?$/, ".")} Could not put back ${left.map((at) => this.shown(at)).join(", ")}.`,
			error instanceof KindedError ? error.hint : undefined,
			{ cause: error }
		);
	}

	private async reverse(change: Change): Promise<void> {
		if (change.kind === "rename")
			return this.fileSystemService.rename(change.to, change.from);
		if (change.kind === "changed")
			return this.fileSystemService.writeFile(
				change.path,
				change.earlier
			);
		return this.fileSystemService.delete(change.path, true);
	}

	/** Makes `directory` with the folders above it that are missing, recording the outermost, whose removal removes them all. */
	private async recordMissing(directory: string): Promise<void> {
		let missing: string | undefined;
		for (const folder of selfAndAncestors(directory)) {
			if (await this.fileSystemService.exists(folder)) break;
			missing = folder;
		}
		if (missing === undefined) return;
		await this.fileSystemService.createDirectory(directory);
		this.changes.push({ kind: "created", path: missing });
	}

	private shown(at: string): string {
		const relative = path.relative(this.directory, at);
		return relative === "" || relative.startsWith("..") ? at : relative;
	}
}
