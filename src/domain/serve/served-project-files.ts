import { samePath } from "../../base/path.js";
import { SyncServer } from "../runner/sync-server.js";
import { ServeAddress } from "./serve.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecord, ServerRecords } from "./server-records.js";

/** The project files that running serves serve. */
export class ServedProjectFiles {
	constructor(
		private readonly records: ServerRecords,
		private readonly probe: ServerProbe
	) {}

	/** For each of `files` that a running serve serves, the record of that serve. The records are read once, and each server is asked once. */
	async serving(
		files: readonly string[]
	): Promise<ReadonlyMap<string, ServerRecord>> {
		const candidates = (await this.records.all()).filter((record) =>
			files.some((file) => samePath(record.projectFile, file))
		);
		const running = await Promise.all(
			candidates.map(async (record) =>
				(await this.isRunning(record)) ? record : undefined
			)
		);
		const found = new Map<string, ServerRecord>();
		for (const record of running) {
			if (!record) continue;
			for (const file of files)
				if (!found.has(file) && samePath(record.projectFile, file))
					found.set(file, record);
		}
		return found;
	}

	/** Whether the server of `record` still answers, as the one the serve started: a crashed serve leaves its record behind. */
	private async isRunning(record: ServerRecord): Promise<boolean> {
		const server = SyncServer.byId(record.server);
		if (!server) return false;
		const state = await this.probe.probe(
			new ServeAddress(record.host, record.port),
			server
		);
		return (
			state.kind === "serving" &&
			state.info.project === record.project &&
			state.info.session === record.session
		);
	}
}
