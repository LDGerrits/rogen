import path from "path";
import { isObject } from "../../base/objects.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServeAddress, ServerInfo } from "./serve.js";

/** What a serve records of the project file it serves. */
export interface ServedBuild {
	readonly projectFile: string;
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
}

function recordIn(value: unknown): ServerRecord | undefined {
	if (
		!isObject(value) ||
		typeof value.host !== "string" ||
		typeof value.port !== "number" ||
		typeof value.server !== "string" ||
		typeof value.project !== "string" ||
		typeof value.projectFile !== "string" ||
		(value.session !== undefined && typeof value.session !== "string") ||
		(value.clients !== undefined && typeof value.clients !== "number")
	)
		return undefined;
	return {
		host: value.host,
		port: value.port,
		server: value.server,
		project: value.project,
		session: value.session,
		projectFile: value.projectFile,
		clients: value.clients,
	};
}

/** The records of the servers running serves started, one per port, in a folder every serve on the machine shares. */
export class ServerRecords {
	private readonly dir: string;

	constructor(
		private readonly fileSystemService: FileSystemService,
		tmpDir: string
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
				session: info.session,
				project: info.project,
				projectFile: built.projectFile,
				clients: built.clients,
			})
		);
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
