import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileSystemService,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import {
	CONFIG_SUFFIX,
	DEFAULT_CONFIG_STEM,
	configFileName,
} from "./config.js";
import { ConfigRefs } from "./config-service.js";

const DEFAULT_CONFIG_NAME = configFileName(DEFAULT_CONFIG_STEM);

/** Finds which config files a command reads, in the working directory. */
export class ConfigDiscovery {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {}

	/** The config files `refs` names, or the default config when it names none, or every config when it asks for all. */
	async discover({
		names,
		paths: explicitPaths = [],
		all,
	}: Pick<ConfigRefs, "names" | "all"> &
		Partial<Pick<ConfigRefs, "paths">>): Promise<Result<string[], Error>> {
		if (all) return this.find();

		const cwd = this.environmentService.cwd;
		const resolved: string[] = [];

		if (names.length === 0 && explicitPaths.length === 0) {
			const defaultResult = await this.resolveDefault();
			if (defaultResult.isErr()) return defaultResult;
			resolved.push(defaultResult.unwrap());
		} else {
			for (const name of names) {
				const candidate = path.join(cwd, configFileName(name));
				if (!(await this.fileSystemService.exists(candidate))) {
					return err(
						new Error(
							`Config "${name}" not found: looked for ${candidate}`
						)
					);
				}
				resolved.push(candidate);
			}

			for (const explicitPath of explicitPaths) {
				const candidate = path.resolve(cwd, explicitPath);
				if (!(await this.fileSystemService.exists(candidate))) {
					return err(
						new Error(
							`Specified config file not found: ${candidate}`
						)
					);
				}
				resolved.push(candidate);
			}
		}

		const duplicate = findDuplicate(resolved);
		if (duplicate) {
			return err(
				new Error(
					`"${duplicate}" was named more than once; each config can ` +
						`only be built once per invocation.`
				)
			);
		}

		return ok(resolved);
	}

	/** Every `*.rogen.json` directly in the working directory, as sorted absolute paths; fails when there is none. */
	async find(): Promise<Result<string[], Error>> {
		const cwd = this.environmentService.cwd;
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(cwd)
		);
		if (listing.isErr()) {
			return err(
				new Error(
					`Could not look for a config file in ${cwd}: ${listing.error.message}`,
					{ cause: listing.error }
				)
			);
		}

		const candidates = configFileNames(listing.value);

		if (candidates.length === 0) {
			return err(
				new Error(
					`No config file found in ${cwd}. Looked for ` +
						`${DEFAULT_CONFIG_NAME} or any *${CONFIG_SUFFIX}. Run ` +
						`"rogen init" to create one.`
				)
			);
		}

		return ok(candidates.map((name) => path.join(cwd, name)));
	}

	private async resolveDefault(): Promise<Result<string, Error>> {
		const cwd = this.environmentService.cwd;
		const defaultPath = path.join(cwd, DEFAULT_CONFIG_NAME);
		if (await this.fileSystemService.exists(defaultPath)) {
			return ok(defaultPath);
		}

		const found = await this.find();
		if (found.isErr()) return found;

		if (found.value.length === 1) {
			return ok(found.value[0]);
		}

		return err(
			new Error(
				`Several config files found in ${cwd} and none is named ` +
					`${DEFAULT_CONFIG_NAME}: ${found.value.map((file) => path.basename(file)).join(", ")}. Run ` +
					`"rogen build <name>" or pass -c to pick one.`
			)
		);
	}
}

function configFileNames(entries: readonly [string, FileType][]): string[] {
	return entries
		.filter(
			([name, type]) => isFileType(type) && name.endsWith(CONFIG_SUFFIX)
		)
		.map(([name]) => name)
		.sort();
}

function findDuplicate(paths: readonly string[]): string | undefined {
	const seen = new Set<string>();
	for (const candidate of paths) {
		if (seen.has(candidate)) return candidate;
		seen.add(candidate);
	}
	return undefined;
}
