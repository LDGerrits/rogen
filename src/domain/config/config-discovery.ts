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
import { relativeTo } from "../../base/path.js";
import { CONFIG_SUFFIX, configLabel } from "./config.js";
import { EnclosingConfigs } from "./config-service.js";
import { ConfigTree } from "./config-tree.js";

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
	/** Whether none was named, so `files` is every config in `directory` and each below that extends one there or above. */
	readonly everyConfig: boolean;
	/** The configs below `directory` that extend nothing there or above, when none was named. */
	readonly separate: readonly string[];
	/** Every folder searched for configs, when none was named. */
	readonly folders: readonly string[];
}

/** Finds which config files a command reads: in the working directory and the folders below it, else in the nearest folder above that has any. */
export class ConfigDiscovery {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {}

	/** The config files `refs` names, each a name or a path, or every config of the folder found when it names none. A name resolves among that folder's configs, a path from the working directory. */
	async discover(
		refs: readonly string[]
	): Promise<Result<DiscoveredConfigs, Error>> {
		const cwd = this.environmentService.cwd;
		const home = await this.home();
		if (refs.length === 0) {
			if (home.isErr()) return err(home.error);
			const found = await this.find(home.value.directory);
			if (found.isErr()) return err(found.error);
			const { members, separate, folders } = found.value;
			return ok({
				directory: home.value.directory,
				files: members,
				everyConfig: true,
				separate,
				folders,
			});
		}

		// With nothing to find configs in, a name fails as not found, in the working directory.
		const directory = home.isOk() ? home.value.directory : cwd;
		const tree = refs.every(isConfigPath)
			? undefined
			: await this.find(directory);
		if (tree?.isErr()) return err(tree.error);
		const resolved: string[] = [];
		for (const ref of refs) {
			if (isConfigPath(ref)) {
				const candidate = path.resolve(cwd, ref);
				if (!(await this.fileSystemService.exists(candidate)))
					return err(
						new UsageError(`Config file not found: ${candidate}`)
					);
				resolved.push(candidate);
				continue;
			}
			const found = tree!.unwrap();
			const named = found.members.find(
				(file) => configLabel(file) === ref
			);
			if (!named) return err(this.notFound(ref, directory, found));
			resolved.push(named);
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

		return ok({
			directory,
			files: resolved,
			everyConfig: false,
			separate: [],
			folders: [],
		});
	}

	/** The configs of `directory` and the folders below it; fails when two that belong share a name. */
	async find(directory: string): Promise<Result<ConfigTree, Error>> {
		const tree = await ConfigTree.read(this.fileSystemService, directory);
		const clash = sameName(tree.members);
		if (clash) {
			const [first, second] = clash.map((file) =>
				relativeTo(this.environmentService.cwd, file)
			);
			return err(
				new UsageError(
					`Two configs are named "${configLabel(clash[0])}": ${first} and ${second}. Rename one, since a name has to mean one config.`
				)
			);
		}
		return ok(tree);
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

	/** Why `name` names no config of `directory`'s: it is a separate project's, else a likely misspelling, else what is there. */
	private notFound(name: string, directory: string, tree: ConfigTree): Error {
		const relative = (file: string) =>
			relativeTo(this.environmentService.cwd, file);
		const separate = tree.separate.find(
			(file) => configLabel(file) === name
		);
		if (separate) {
			return new UsageError(
				`Config "${name}" is ${relative(separate)}, which extends nothing here, so it is a separate project. Add "extends" to make it part of this one, or build it by its path.`
			);
		}
		const labels = tree.members.map(configLabel);
		const suggestion = closestMatch(name, labels);
		const hint = suggestion
			? `Did you mean "${suggestion}"?`
			: labels.length > 0
				? `Configs here: ${labels.join(", ")}.`
				: `Run "rogen init" to create one.`;
		return new UsageError(
			`Config "${name}" not found: looked for ${path.join(directory, `${name}${CONFIG_SUFFIX}`)}. ${hint}`
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

/** The first two of `files` with one name. */
function sameName(files: readonly string[]): [string, string] | undefined {
	const seen = new Map<string, string>();
	for (const file of files) {
		const label = configLabel(file);
		const other = seen.get(label);
		if (other) return [other, file];
		seen.set(label, file);
	}
	return undefined;
}
