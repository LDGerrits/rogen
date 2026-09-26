import path from "path";
import {
	FileSystemService,
	FileType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";

/** The name a config is asked for by, e.g. `lobby` for `lobby.rogen.json`. */
export const configLabel = (file: string): string =>
	path.basename(file, CONFIG_SUFFIX);

const DEFAULT_CONFIG_NAME = `${DEFAULT_CONFIG_STEM}${CONFIG_SUFFIX}`;

export async function discoverConfigPaths(
	fileSystem: FileSystemService,
	cwd: string,
	names: readonly string[],
	explicitPaths: readonly string[] = []
): Promise<Result<string[], Error>> {
	const resolved: string[] = [];

	if (names.length === 0 && explicitPaths.length === 0) {
		const defaultResult = await resolveDefaultConfig(fileSystem, cwd);
		if (defaultResult.isErr()) return defaultResult;
		resolved.push(defaultResult.unwrap());
	} else {
		for (const name of names) {
			const candidate = path.join(cwd, `${name}${CONFIG_SUFFIX}`);
			if (!(await fileSystem.exists(candidate))) {
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
			if (!(await fileSystem.exists(candidate))) {
				return err(
					new Error(`Specified config file not found: ${candidate}`)
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

/** Every `*.rogen.json` directly in `cwd`, as sorted absolute paths; fails when there is none. */
export async function findConfigFiles(
	fileSystem: FileSystemService,
	cwd: string
): Promise<Result<string[], Error>> {
	let entries: [string, FileType][];
	try {
		entries = await fileSystem.readDirectory(cwd);
	} catch (error) {
		return err(
			new Error(
				`Could not look for a config file in ${cwd}: ` +
					`${ErrorUtils.fromUnknown(error).message}`,
				{ cause: error }
			)
		);
	}

	const candidates = configFileNames(entries);

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

async function resolveDefaultConfig(
	fileSystem: FileSystemService,
	cwd: string
): Promise<Result<string, Error>> {
	const defaultPath = path.join(cwd, DEFAULT_CONFIG_NAME);
	if (await fileSystem.exists(defaultPath)) {
		return ok(defaultPath);
	}

	const found = await findConfigFiles(fileSystem, cwd);
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

function configFileNames(entries: readonly [string, FileType][]): string[] {
	return entries
		.filter(
			([name, type]) => isFileType(type) && name.endsWith(CONFIG_SUFFIX)
		)
		.map(([name]) => name)
		.sort();
}

/** One line naming the configs in `cwd` that are not among `requested`, or `undefined` when there are none. */
export async function unrequestedConfigNotice(
	fileSystem: FileSystemService,
	cwd: string,
	requested: readonly string[]
): Promise<string | undefined> {
	const found = await findConfigFiles(fileSystem, cwd);
	if (found.isErr()) return undefined;

	const skipped = found.value
		.filter((file) => !requested.includes(file))
		.map((file) => path.basename(file));
	return skipped.length > 0
		? `Not building: ${skipped.join(", ")}.`
		: undefined;
}

function findDuplicate(paths: readonly string[]): string | undefined {
	const seen = new Set<string>();
	for (const candidate of paths) {
		if (seen.has(candidate)) return candidate;
		seen.add(candidate);
	}
	return undefined;
}
