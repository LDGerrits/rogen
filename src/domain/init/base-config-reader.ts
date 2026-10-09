import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
	configFileName,
} from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig } from "./init-directory.js";

/** Reads what a place inherits from the configs already in a directory. */
export class BaseConfigReader {
	constructor(
		private readonly configService: ConfigService,
		/** The absolute path of the directory. */
		private readonly directory: string
	) {}

	/** `default.rogen.json` resolved the way a build would, so a place joins a config that builds. A Darklua repo's default is source-rooted, so its sync dir comes from the synced config beside it. */
	async read(
		entries: ReadonlySet<string>
	): Promise<Result<BaseConfig, Diagnostic[]>> {
		const entry = await this.configService.read(
			path.join(this.directory, configFileName(DEFAULT_CONFIG_STEM))
		);
		if (entry.status === "broken") return err([...entry.errors]);

		const { rootDirs } = entry.config;
		const syncFile = configFileName(
			ConfigSet.syncStemOf(DEFAULT_CONFIG_STEM)
		);
		const syncDir =
			entry.config.syncDir ??
			(entries.has(syncFile)
				? await this.syncDirOf(syncFile)
				: undefined);
		return ok({
			rootDirs: rootDirs.map((dir) => this.relative(dir)),
			...(syncDir && { syncDir: this.relative(syncDir) }),
			ports: await this.portsIn(entries),
		});
	}

	/** The serve port of every config here whose template sets one; a config that doesn't build is skipped. */
	private async portsIn(entries: ReadonlySet<string>): Promise<number[]> {
		const ports = new Set<number>();
		for (const entry of [...entries].filter((name) =>
			name.endsWith(CONFIG_SUFFIX)
		)) {
			const read = await this.configService.read(
				path.join(this.directory, entry)
			);
			const port =
				read.status === "valid"
					? read.config.template?.project.servePort
					: undefined;
			if (port !== undefined) ports.add(port);
		}
		return [...ports];
	}

	/** The absolute sync dir the config in `fileName` resolves to, if it has one and builds. */
	private async syncDirOf(fileName: string): Promise<string | undefined> {
		const entry = await this.configService.read(
			path.join(this.directory, fileName)
		);
		return entry.status === "valid" ? entry.config.syncDir : undefined;
	}

	private relative(absolute: string): string {
		return toPosix(path.relative(this.directory, absolute));
	}
}
