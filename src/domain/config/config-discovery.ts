import path from "path";
import {
	FileSystemService,
	FileType,
} from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";
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

async function resolveDefaultConfig(
	fileSystem: FileSystemService,
	cwd: string
): Promise<Result<string, Error>> {
	const defaultPath = path.join(cwd, DEFAULT_CONFIG_NAME);
	if (await fileSystem.exists(defaultPath)) {
		return ok(defaultPath);
	}

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

	const candidates = entries
		.filter(
			([name, type]) =>
				type === FileType.File && name.endsWith(CONFIG_SUFFIX)
		)
		.map(([name]) => name)
		.sort();

	if (candidates.length === 0) {
		return err(
			new Error(
				`No config file found in ${cwd}. Looked for ` +
					`${DEFAULT_CONFIG_NAME} or any *${CONFIG_SUFFIX}. Run ` +
					`"rogen init" to create one.`
			)
		);
	}

	if (candidates.length === 1) {
		return ok(path.join(cwd, candidates[0]));
	}

	return err(
		new Error(
			`Several config files found in ${cwd} and none is named ` +
				`${DEFAULT_CONFIG_NAME}: ${candidates.join(", ")}. Run ` +
				`"rogen build <name>" or pass -c to pick one.`
		)
	);
}

function findDuplicate(paths: readonly string[]): string | undefined {
	const seen = new Set<string>();
	for (const candidate of paths) {
		if (seen.has(candidate)) return candidate;
		seen.add(candidate);
	}
	return undefined;
}
