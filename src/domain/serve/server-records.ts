import path from "path";
import { isObject } from "../../base/objects.js";
import { samePath } from "../../base/path.js";
import { FileReplacer } from "../../platform/fs/file-replacer.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServerInfo } from "../runner/rojo-server.js";
import { ServeAddress } from "./serve.js";

interface ServedProject {
	readonly projectFile: string;
	readonly configFile?: string;
	readonly pid?: number;
}

export interface ServerRecord extends ServedProject {
	readonly host: string;
	readonly port: number;
	readonly project: string;
	readonly session?: string;
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

	private readonly replacer: FileReplacer;

	constructor(
		tmpDir: string,
		private readonly owner: number,
		@FileSystemService private readonly fileSystemService: FileSystemService
	) {
		this.replacer = new FileReplacer(fileSystemService);
		this.dir = path.join(tmpDir, "rogen-serve");
	}

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
		await this.replacer.replace(
			this.fileOf(address.port),
			this.stagingFileOf(address.port),
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

	async remove(address: ServeAddress, info: ServerInfo): Promise<void> {
		const file = this.fileOf(address.port);
		const record = await this.read(file);
		if (record?.owner === this.owner && record.session === info.session)
			await this.fileSystemService.delete(file).catch(() => undefined);
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

	private stagingFileOf(port: number): string {
		return `${this.fileOf(port)}.${this.owner}.tmp`;
	}
}
