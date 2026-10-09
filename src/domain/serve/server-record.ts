import path from "path";
import { isObject } from "../../base/objects.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ServeAddress, ServerInfo } from "./serve.js";

/** What a serve wrote about a server it started: the session that answered and the project file it serves. A server only names its project, so this is how another checkout of the same project tells the server isn't its own. */
export interface ServerRecord {
	readonly session?: string;
	readonly project: string;
	readonly projectFile: string;
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

	/** The record of the server on `address`, when it is still the one that answers with `info`. */
	async read(
		address: ServeAddress,
		info: ServerInfo
	): Promise<ServerRecord | undefined> {
		let value: unknown;
		try {
			value = JSON.parse(
				await this.fileSystemService.readFile(this.fileOf(address))
			);
		} catch {
			return undefined;
		}
		if (
			!isObject(value) ||
			typeof value.projectFile !== "string" ||
			value.project !== info.project ||
			value.session !== info.session
		)
			return undefined;
		return {
			session: info.session,
			project: info.project,
			projectFile: value.projectFile,
		};
	}

	async write(
		address: ServeAddress,
		info: ServerInfo,
		projectFile: string
	): Promise<void> {
		await this.fileSystemService.writeFile(
			this.fileOf(address),
			JSON.stringify({
				session: info.session,
				project: info.project,
				projectFile,
			})
		);
	}

	async remove(address: ServeAddress): Promise<void> {
		await this.fileSystemService.delete(this.fileOf(address));
	}

	private fileOf(address: ServeAddress): string {
		return path.join(this.dir, `${address.port}.json`);
	}
}
