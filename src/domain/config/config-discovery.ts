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
import { CONFIG_SUFFIX, configFileName, configLabel } from "./config.js";
import { EnclosingConfigs } from "./config-service.js";

/** Whether a config the command line gives is a path rather than a name: it holds a path separator or ends in `.json`. */
function isConfigPath(ref: string): boolean {
	return ref.includes("/") || ref.includes("\\") || ref.endsWith(".json");
}

/** The config files a command reads, and the folder it looked in. */
export interface DiscoveredConfigs {
	/** The working directory, or the nearest folder above it with configs when the working directory has none. */
	readonly directory: string;
	/** Absolute paths. */
	readonly files: readonly string[];
	/** Whether none was named, so `files` is every config in `directory`. */
	readonly everyConfig: boolean;
}

/** Finds which config files a command reads: in the working directory, else in the nearest folder above that has any. */
export class ConfigDiscovery {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {}

	/** The config files `refs` names, each a name or a path, or every config in the folder found when it names none. A name resolves in that folder, a path from the working directory. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const home = await this.home();
		if (refs.length === 0) {
			if (home.isErr()) return err(home.error);
			const { directory, fileNames } = home.value;
			return ok({
				directory,
				files: fileNames.map((name) => path.join(directory, name)),
				everyConfig: true,
			});
		}

		// With nothing to find configs in, a name fails as not found, in the working directory.
		const directory = home.isOk() ? home.value.directory : cwd;
		const resolved: string[] = [];
		for (const ref of refs) {
			const isPath = isConfigPath(ref);
			const candidate = isPath
				? path.resolve(cwd, ref)
				: path.join(directory, configFileName(ref));
			if (!(await this.fileSystemService.exists(candidate))) {
				return err(
					isPath
						? new UsageError(`Config file not found: ${candidate}`)
						: await this.notFound(ref, candidate, directory)
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

		return ok({ directory, files: resolved, everyConfig: false });
	}

	/** Every `*.rogen.json` directly in `directory`, as sorted absolute paths; none when it can't be read. */
	async list(directory: string): Promise<string[]> {
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		return listing.isErr()
			? []
			: configFileNames(listing.value).map((name) =>
					path.join(directory, name)
				);
	}

	/** The folder configs are read from: the working directory when it has any, else the nearest folder above that does. */
	private async home(): Promise<Result<EnclosingConfigs, Error>> {
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

		const fileNames = configFileNames(listing.value);
		if (fileNames.length > 0) return ok({ directory: cwd, fileNames });

		const enclosing = await this.findEnclosing();
		return enclosing
			? ok(enclosing)
			: err(
					new Error(
						`No *${CONFIG_SUFFIX} found in ${cwd}. Run "rogen init" to create one.`
					)
				);
	}

	/** The nearest parent of the working directory that has configs. */
	async findEnclosing(): Promise<EnclosingConfigs | undefined> {
		let directory = this.environmentService.cwd;
		for (;;) {
			const parent = path.dirname(directory);
			if (parent === directory) return undefined;
			directory = parent;
			const listing = await tryWithAsync(() =>
				this.fileSystemService.readDirectory(directory)
			);
			if (listing.isErr()) continue;
			const fileNames = configFileNames(listing.value);
			if (fileNames.length > 0) return { directory, fileNames };
		}
	}

	/** Suggests the config in `directory` that `name` is most likely a misspelling of, else lists the ones there. */
	private async notFound(
		name: string,
		candidate: string,
		directory: string
	): Promise<Error> {
		const labels = (await this.list(directory)).map(configLabel);
		const suggestion = closestMatch(name, labels);
		const hint = suggestion
			? `Did you mean "${suggestion}"?`
			: labels.length > 0
				? `Configs here: ${labels.join(", ")}.`
				: `Run "rogen init" to create one.`;
		return new UsageError(
			`Config "${name}" not found: looked for ${candidate}. ${hint}`
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
