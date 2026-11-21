import path from "path";
import { selfAndAncestors, shownFrom } from "../../base/path.js";
import { tryWithAsync } from "../../base/result.js";
import {
	FileSystemService,
	FileType,
} from "../../platform/fs/file-system-service.js";

const UNLISTED = "node_modules";

type Change =
	| { readonly kind: "rename"; readonly from: string; readonly to: string }
	| { readonly kind: "created"; readonly path: string }
	| { readonly kind: "removedFolder"; readonly path: string }
	| {
			readonly kind: "removed";
			readonly path: string;
			readonly bytes: Uint8Array;
	  }
	| {
			readonly kind: "changed";
			readonly path: string;
			readonly earlier: string;
	  };

export class UndoLog {
	private readonly changes: Change[] = [];

	constructor(
		private readonly directory: string,
		@FileSystemService private readonly fileSystemService: FileSystemService
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

	async createDirectory(directory: string): Promise<boolean> {
		if (await this.fileSystemService.exists(directory)) return false;
		await this.recordMissing(directory);
		return true;
	}

	async recordAdded<T>(directory: string, run: () => Promise<T>): Promise<T> {
		const before = await this.listing(directory);
		const done = await run();
		const added: string[] = [];
		for (const entry of await this.listing(directory))
			if (
				!before.has(entry) &&
				!added.some((folder) => entry.startsWith(folder + path.sep))
			)
				added.push(entry);
		for (const entry of added)
			this.changes.push({ kind: "created", path: entry });
		return done;
	}

	async delete(target: string): Promise<void> {
		const removed: Change[] = [];
		const keep = async (at: string): Promise<void> => {
			if (!(await this.fileSystemService.isDirectory(at))) {
				removed.push({
					kind: "removed",
					path: at,
					bytes: await this.fileSystemService.readFileBytes(at),
				});
				return;
			}
			removed.push({ kind: "removedFolder", path: at });
			for (const [name] of await this.fileSystemService.readDirectory(at))
				await keep(path.join(at, name));
		};
		await keep(target);
		await this.fileSystemService.delete(target, true);
		this.changes.push(...removed);
	}

	async undo(): Promise<string[]> {
		const left: string[] = [];
		for (const change of this.changes.reverse()) {
			const undone = await tryWithAsync(() => this.reverse(change));
			if (undone.isErr())
				left.push(
					this.shown(
						change.kind === "rename" ? change.to : change.path
					)
				);
		}
		return left;
	}

	private async reverse(change: Change): Promise<void> {
		if (change.kind === "rename")
			return this.fileSystemService.rename(change.to, change.from);
		if (change.kind === "removed")
			return this.fileSystemService.writeFileBytes(
				change.path,
				change.bytes
			);
		if (change.kind === "removedFolder")
			return this.fileSystemService.createDirectory(change.path);
		if (change.kind === "changed")
			return this.fileSystemService.writeFile(
				change.path,
				change.earlier
			);
		return this.fileSystemService.delete(change.path, true);
	}

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

	private async listing(directory: string): Promise<Set<string>> {
		const found = new Set<string>();
		const walk = async (folder: string): Promise<void> => {
			const entries = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(folder)
			);
			if (entries.isErr()) return;
			for (const [name, type] of entries.value) {
				const at = path.join(folder, name);
				found.add(at);
				if (type === FileType.Directory && name !== UNLISTED)
					await walk(at);
			}
		};
		await walk(directory);
		return found;
	}

	private shown(at: string): string {
		return shownFrom(this.directory, at);
	}
}
