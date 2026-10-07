import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileSystemService,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import {
	CONFIG_SUFFIX,
	configFileName,
	configLabel,
} from "./config.js";

/** Whether a config the command line gives is a path rather than a name: it holds a path separator or ends in `.json`. */
function isConfigPath(ref: string): boolean {
	return ref.includes("/") || ref.includes("\\") || ref.endsWith(".json");
}

/** Finds which config files a command reads, in the working directory. */
export class ConfigDiscovery {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {}

	/** The config files `refs` names, each a name or a path, or every config here when it names none. */
	async discover(refs: readonly string[]): Promise<Result<string[], Error>> {
		if (refs.length === 0) return this.find();

		const cwd = this.environmentService.cwd;
		const resolved: string[] = [];
		for (const ref of refs) {
			const isPath = isConfigPath(ref);
			const candidate = isPath
				? path.resolve(cwd, ref)
				: path.join(cwd, configFileName(ref));
			if (!(await this.fileSystemService.exists(candidate))) {
				return err(
					isPath
						? new UsageError(`Config file not found: ${candidate}`)
						: await this.notFound(ref, candidate)
				);
			}
			resolved.push(candidate);
		}

		const duplicate = findDuplicate(resolved);
		if (duplicate) {
			return err(
				new UsageError(
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
					`No *${CONFIG_SUFFIX} found in ${cwd}. Run "rogen init" to create one.`
				)
			);
		}

		return ok(candidates.map((name) => path.join(cwd, name)));
	}

	/** Suggests the config here that `name` is most likely a misspelling of. */
	private async notFound(name: string, candidate: string): Promise<Error> {
		const found = await this.find();
		const suggestion = closestMatch(
			name,
			found.isOk() ? found.value.map(configLabel) : []
		);
		return new UsageError(
			`Config "${name}" not found: looked for ${candidate}` +
				(suggestion ? `. Did you mean "${suggestion}"?` : "")
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
