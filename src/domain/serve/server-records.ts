import path from "path";
import { isObject } from "../../base/objects.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { BuildSetting } from "../build/build.js";
import { ServeAddress, ServerInfo } from "./serve.js";

/** What a serve writes into the project file it serves, which a later build or serve checks against its own. */
export interface ServedBuild {
	readonly projectFile: string;
	readonly setting: BuildSetting;
	/** How many Studio plugins are connected; none when the server doesn't say. */
	readonly clients?: number;
}

/** What a serve recorded of a server it started. */
export interface ServerRecord extends ServedBuild {
	readonly host: string;
	readonly port: number;
	/** The id of the sync server. */
	readonly server: string;
	readonly project: string;
	readonly session?: string;
	/** The process of the serve that wrote it. */
	readonly pid?: number;
}

function recordIn(value: unknown): ServerRecord | undefined {
	if (
		!isObject(value) ||
		typeof value.host !== "string" ||
		typeof value.port !== "number" ||
		typeof value.server !== "string" ||
		typeof value.project !== "string" ||
		typeof value.projectFile !== "string" ||
		!isObject(value.variants) ||
		(value.session !== undefined && typeof value.session !== "string") ||
		(value.pid !== undefined && typeof value.pid !== "number") ||
		(value.clients !== undefined && typeof value.clients !== "number")
	)
		return undefined;
	return {
		host: value.host,
		port: value.port,
		server: value.server,
		project: value.project,
		session: value.session,
		pid: value.pid,
		projectFile: value.projectFile,
		clients: value.clients,
		setting: {
			variants: Object.fromEntries(
				Object.entries(value.variants).filter(
					(entry): entry is [string, boolean] =>
						typeof entry[1] === "boolean"
				)
			),
		},
	};
}

/** The records of the servers running serves started, one per port, in a folder every serve on the machine shares. */
export class ServerRecords {
	private readonly dir: string;

	constructor(
		private readonly fileSystemService: FileSystemService,
		tmpDir: string,
		/** The process these records are written for. */
		private readonly pid: number
	) {
		this.dir = path.join(tmpDir, "rogen-serve");
	}

	/** What the serve that started the server on `address` recorded of it, when it is still the one that answers with `info`. A server only names its project, so this is how another checkout of the same project tells the server isn't its own. */
	async recordOf(
		address: ServeAddress,
		info: ServerInfo
	): Promise<ServerRecord | undefined> {
		const record = await this.read(this.fileOf(address.port));
		return record &&
			record.project === info.project &&
			record.session === info.session
			? record
			: undefined;
	}

	/** Every record that can be read, whether or not its server still runs. */
	async all(): Promise<ServerRecord[]> {
		let entries: [string, unknown][];
		try {
			entries = await this.fileSystemService.readDirectory(this.dir);
		} catch {
			return [];
		}
		const read = await Promise.all(
			entries
				.map(([name]) => name)
				.filter((name) => name.endsWith(".json"))
				.map((name) => this.read(path.join(this.dir, name)))
		);
		return read.filter((record) => record !== undefined);
	}

	async write(
		address: ServeAddress,
		info: ServerInfo,
		built: ServedBuild
	): Promise<void> {
		await this.fileSystemService.writeFile(
			this.fileOf(address.port),
			JSON.stringify({
				host: address.host,
				port: address.port,
				server: info.server.id,
				pid: this.pid,
				session: info.session,
				project: info.project,
				projectFile: built.projectFile,
				clients: built.clients,
				variants: built.setting.variants,
			})
		);
	}

	/** Whether this process wrote `record`, whose serve rebuilds its project file itself. */
	owns(record: ServerRecord): boolean {
		return record.pid === this.pid;
	}

	async remove(address: ServeAddress): Promise<void> {
		await this.fileSystemService.delete(this.fileOf(address.port));
	}

	private async read(file: string): Promise<ServerRecord | undefined> {
		try {
			return recordIn(
				JSON.parse(await this.fileSystemService.readFile(file))
			);
		} catch {
			return undefined;
		}
	}

	private fileOf(port: number): string {
		return path.join(this.dir, `${port}.json`);
	}
}
