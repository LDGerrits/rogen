import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_CONFIG_STEM,
	configFileName,
	isConfigFileName,
	leafConfigs,
} from "../config/config.js";
import { ConfigEntry, ConfigService } from "../config/config-service.js";
import { SyncServer } from "../serve/serve.js";
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
		names: ReadonlySet<string>
	): Promise<Result<BaseConfig, Diagnostic[]>> {
		const read = await Promise.all(
			[...names]
				.filter(isConfigFileName)
				.map(
					async (name) =>
						[
							name,
							await this.configService.read(
								path.join(this.directory, name)
							),
						] as const
				)
		);
		const entries = new Map(read);
		const entry = entries.get(DEFAULT_CONFIG_FILE);
		if (!entry)
			throw new Error(`${DEFAULT_CONFIG_FILE} is not in the listing.`);
		if (entry.status === "broken") return err([...entry.errors]);

		const sync = entries.get(
			configFileName(ConfigSet.syncStemOf(DEFAULT_CONFIG_STEM))
		);
		const syncDir =
			entry.config.syncDir ??
			(sync?.status === "valid" ? sync.config.syncDir : undefined);
		return ok({
			rootDirs: entry.config.rootDirs.map((dir) => this.relative(dir)),
			...(syncDir && { syncDir: this.relative(syncDir) }),
			...this.portsIn([...entries.values()]),
		});
	}

	/** The serve port of every config here whose template sets one, and whether two configs nothing extends share one, `default` aside, which a place extends. A config that doesn't build is skipped. */
	private portsIn(read: readonly ConfigEntry[]): {
		ports: number[];
		sharedPort: boolean;
	} {
		const valid = read.filter((entry) => entry.status === "valid");
		const served = leafConfigs(valid)
			.filter(({ file }) => path.basename(file) !== DEFAULT_CONFIG_FILE)
			.map(
				({ config }) =>
					config.template?.project.servePort ??
					SyncServer.ROJO.defaultPort
			);
		return {
			ports: [
				...new Set(
					valid.flatMap(({ config }) => {
						const port = config.template?.project.servePort;
						return port === undefined ? [] : [port];
					})
				),
			],
			sharedPort: new Set(served).size < served.length,
		};
	}

	private relative(absolute: string): string {
		return toPosix(path.relative(this.directory, absolute));
	}
}
