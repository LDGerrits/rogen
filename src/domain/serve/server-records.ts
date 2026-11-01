import path from "path";
import { isObject } from "../../base/objects.js";
import { samePath } from "../../base/path.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServerInfo } from "../runner/rojo-server.js";
import { ServeAddress } from "./serve.js";

interface ServedProject {
	readonly projectFile: string;
	/** The config the project file was written from. */
	readonly configFile?: string;
	/** The process that leads the server. */
	readonly pid?: number;
}

export interface ServerRecord extends ServedProject {
	readonly host: string;
	readonly port: number;
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
		typeof value.project !== "string" ||
		typeof value.projectFile !== "string" ||
		(value.session !== undefined && typeof value.session !== "string") ||
		(value.configFile !== undefined &&
			typeof value.configFile !== "string") ||
		(value.owner !== undefined && typeof value.owner !== "number") ||
		(value.pid !== undefined && typeof value.pid !== "number")
	)
		return undefined;
	return {
		host: value.host,
		port: value.port,
		project: value.project,
		session: value.session,
		projectFile: value.projectFile,
		configFile: value.configFile,
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

	/** Every record whose project file is `projectFile`, whatever port it is on. */
	async recordsFor(projectFile: string): Promise<ServerRecord[]> {
		let names: string[];
		try {
			names = (await this.fileSystemService.readDirectory(this.dir)).map(
				([name]) => name
			);
		} catch {
			return [];
		}
		const records: ServerRecord[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const record = await this.read(path.join(this.dir, name));
			if (record && samePath(record.projectFile, projectFile))
				records.push(record);
		}
		return records;
	}

	async write(
		address: ServeAddress,
		info: ServerInfo,
		served: ServedProject
	): Promise<void> {
		await this.fileSystemService.writeFile(
			this.fileOf(address.port),
			JSON.stringify({
				host: address.host,
				port: address.port,
				session: info.session,
				project: info.project,
				projectFile: served.projectFile,
				configFile: served.configFile,
				owner: this.owner,
				pid: served.pid,
			})
		);
	}

	/** Forgets the record of `address` when it is the one this serve wrote for the server that answered with `info`, leaving one another serve wrote since. */
	async remove(address: ServeAddress, info: ServerInfo): Promise<void> {
		const file = this.fileOf(address.port);
		const record = await this.read(file);
		if (record?.owner === this.owner && record.session === info.session)
			await this.fileSystemService.delete(file);
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
