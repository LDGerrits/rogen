import path from "path";
import {
	FileSystemService,
	FileType,
} from "../../platform/fs/file-system-service.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";
const DEFAULT_CONFIG_NAME = `${DEFAULT_CONFIG_STEM}${CONFIG_SUFFIX}`;

export async function discoverConfigPaths(
	fileSystem: FileSystemService,
	cwd: string,
	names: readonly string[],
	explicitPaths: readonly string[] = []
): Promise<Result<string[], Diagnostic[]>> {
	const resolved: string[] = [];

	if (names.length === 0 && explicitPaths.length === 0) {
		const defaultResult = await resolveDefaultConfig(fileSystem, cwd);
		if (defaultResult.isErr()) return defaultResult;
		resolved.push(defaultResult.unwrap());
	} else {
		for (const name of names) {
			const candidate = path.join(cwd, `${name}${CONFIG_SUFFIX}`);
			if (!(await fileSystem.exists(candidate))) {
				return err([
					ConfigDiagnostics.namedNotFound(
						{ resource: candidate },
						name
					),
				]);
			}
			resolved.push(candidate);
		}

		for (const explicitPath of explicitPaths) {
			const candidate = path.resolve(cwd, explicitPath);
			if (!(await fileSystem.exists(candidate))) {
				return err([
					ConfigDiagnostics.pathNotFound({ resource: candidate }),
				]);
			}
			resolved.push(candidate);
		}
	}

	const duplicate = findDuplicate(resolved);
	if (duplicate) {
		return err([ConfigDiagnostics.duplicate({ resource: duplicate })]);
	}

	return ok(resolved);
}

async function resolveDefaultConfig(
	fileSystem: FileSystemService,
	cwd: string
): Promise<Result<string, Diagnostic[]>> {
	const defaultPath = path.join(cwd, DEFAULT_CONFIG_NAME);
	if (await fileSystem.exists(defaultPath)) {
		return ok(defaultPath);
	}

	let entries: [string, FileType][];
	try {
		entries = await fileSystem.readDirectory(cwd);
	} catch (error) {
		return err([
			ConfigDiagnostics.directoryUnreadable(
				{ resource: cwd },
				ErrorUtils.fromUnknown(error).message
			),
		]);
	}

	const candidates = entries
		.filter(
			([name, type]) =>
				type === FileType.File && name.endsWith(CONFIG_SUFFIX)
		)
		.map(([name]) => name)
		.sort();

	if (candidates.length === 0) {
		return err([
			ConfigDiagnostics.noneFound(
				{ resource: cwd },
				`${DEFAULT_CONFIG_NAME} or any *${CONFIG_SUFFIX}`
			),
		]);
	}

	if (candidates.length === 1) {
		return ok(path.join(cwd, candidates[0]));
	}

	return err([
		ConfigDiagnostics.ambiguous(
			{ resource: cwd },
			DEFAULT_CONFIG_NAME,
			candidates
		),
	]);
}

function findDuplicate(paths: readonly string[]): string | undefined {
	const seen = new Set<string>();
	for (const candidate of paths) {
		if (seen.has(candidate)) return candidate;
		seen.add(candidate);
	}
	return undefined;
}
