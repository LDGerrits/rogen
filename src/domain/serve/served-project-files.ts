import path from "path";
import { samePath } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	OutFileGuard,
	PendingWrite,
	describeSetting,
	sameSetting,
} from "../build/build.js";
import { ServeAddress, SyncServer } from "./serve.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecord, ServerRecords } from "./server-records.js";

/** The project files that running serves serve, which a build may not change into another mode's or variants'. */
export class ServedProjectFiles {
	constructor(
		private readonly records: ServerRecords,
		private readonly probe: ServerProbe
	) {}

	/** The guard `build` asks before it changes a project file. */
	readonly guard: OutFileGuard = (write) => this.refusalFor(write);

	/** Why `write` must not be made: another serve that still runs serves the file as built in another setting, so Studio would get the new content. A serve rebuilds its own file as its config changes, so a record of this process never refuses. */
	async refusalFor(write: PendingWrite): Promise<Diagnostic | undefined> {
		for (const record of await this.records.all()) {
			if (
				this.records.owns(record) ||
				!samePath(record.projectFile, write.file) ||
				sameSetting(record.setting, write.setting)
			)
				continue;
			if (await this.isRunning(record))
				return this.refusal(write, record);
		}
		return undefined;
	}

	/** The record of a running serve that serves `file`, whatever mode it built in. */
	async servingOf(file: string): Promise<ServerRecord | undefined> {
		for (const record of await this.records.all()) {
			if (
				samePath(record.projectFile, file) &&
				(await this.isRunning(record))
			)
				return record;
		}
		return undefined;
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

	private refusal(write: PendingWrite, record: ServerRecord): Diagnostic {
		const server = SyncServer.byId(record.server);
		const where = `${server?.name ?? record.server} at ${record.host}:${record.port}`;
		return errorDiagnostic(
			"output.servedInOtherMode",
			{ resource: write.file },
			`${path.basename(write.file)} is served by a running rogen serve (${where}) as built in ${describeSetting(record.setting)}, and this build is ${describeSetting(write.setting)}, so writing it would change what Studio gets. Build to another file, as 'rogen build ${write.label} -o <file>', or stop that serve.`
		);
	}
}
