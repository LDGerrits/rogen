import { Sequencer } from "../../base/async.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateRecord {
	readonly checkedAt: number;
	readonly versions: readonly string[];
	readonly announced?: { readonly version: string; readonly at: number };
}

const EMPTY: UpdateRecord = { checkedAt: 0, versions: [] };

export class UpdateCache {
	// Each change reads and writes the file, so they run one at a time.
	private readonly changes = new Sequencer();

	constructor(
		private readonly file: string,
		private readonly now: () => number,
		@FileSystemService
		private readonly fileSystemService: FileSystemService
	) {}

	async isDue(): Promise<boolean> {
		return this.now() - (await this.read()).checkedAt >= DAY_MS;
	}

	async versions(): Promise<readonly string[]> {
		return (await this.read()).versions;
	}

	/** Keeps the versions it knew when a check found none. */
	recordCheck(versions: readonly string[]): Promise<void> {
		return this.changes.queue(async () => {
			const record = await this.read();
			await this.write({
				...record,
				checkedAt: this.now(),
				versions: versions.length > 0 ? versions : record.versions,
			});
		});
	}

	/** Says whether this is the first announcement of the version in a day. */
	announce(version: string): Promise<boolean> {
		return this.changes.queue(async () => {
			const record = await this.read();
			const { announced } = record;
			if (
				announced?.version === version &&
				this.now() - announced.at < DAY_MS
			)
				return false;
			await this.write({
				...record,
				announced: { version, at: this.now() },
			});
			return true;
		});
	}

	private async read(): Promise<UpdateRecord> {
		try {
			const value = JSON.parse(
				await this.fileSystemService.readFile(this.file)
			) as Partial<UpdateRecord> | null;
			return {
				checkedAt:
					typeof value?.checkedAt === "number" ? value.checkedAt : 0,
				versions: Array.isArray(value?.versions)
					? value.versions.filter((v) => typeof v === "string")
					: [],
				announced:
					typeof value?.announced?.version === "string" &&
					typeof value.announced.at === "number"
						? value.announced
						: undefined,
			};
		} catch {
			return EMPTY;
		}
	}

	private async write(record: UpdateRecord): Promise<void> {
		await this.fileSystemService
			.writeFile(this.file, JSON.stringify(record))
			.catch(() => undefined);
	}
}
