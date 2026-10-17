import path from "path";
import { isObject } from "../../base/objects.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServerInfo } from "../runner/sync-server.js";
import { ServeAddress } from "./serve.js";

interface ServedBuild {
	readonly projectFile: string;
	readonly clients?: number;
	/** The process that leads the server. */
	readonly pid?: number;
}

export interface ServerRecord extends ServedBuild {
	readonly host: string;
	readonly port: number;
	readonly server: string;
	readonly project: string;
	readonly session?: string;
	/** The `rogen serve` process that started the server. */
	readonly owner?: number;
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
		(value.clients !== undefined && typeof value.clients !== "number") ||
		(value.owner !== undefined && typeof value.owner !== "number") ||
		(value.pid !== undefined && typeof value.pid !== "number")
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
		owner: value.owner,
		pid: value.pid,
	};
}

export class ServerRecords {
	private readonly dir: string;

	constructor(
		private readonly fileSystemService: FileSystemService,
		tmpDir: string,
		private readonly owner: number
	) {
		this.dir = path.join(tmpDir, "rogen-serve");
	}

	/** The record of the serve that started the server on `address`, when its project and session match `info`. */
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

	/** Every readable record, including those of servers that no longer run. */
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
				owner: this.owner,
				pid: built.pid,
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
