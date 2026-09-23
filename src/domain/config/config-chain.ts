import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { toPosix } from "../../base/path.js";
import { Result, ok, err } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	Diagnostic,
	DiagnosticLocation,
	Diagnostics,
} from "../diagnostics/diagnostic.js";
import { parseConfig } from "./config-parser.js";
import { CollapsedConfig, RogenConfig } from "./config.js";

interface Layer {
	readonly file: string;
	readonly config: RogenConfig;
	readonly extendsLocation?: DiagnosticLocation;
}

export async function collapseConfig(
	fileSystem: FileSystemService,
	file: string
): Promise<Result<CollapsedConfig, Diagnostic[]>> {
	const layers: Layer[] = [];
	let current = file;
	let referrer: DiagnosticLocation | undefined;

	for (;;) {
		const cycleStart = layers.findIndex((layer) => layer.file === current);
		if (cycleStart >= 0 && referrer) {
			const cycle = [
				...layers.slice(cycleStart).map((l) => l.file),
				current,
			];
			return err([Diagnostics.extendsCycle(referrer, cycle)]);
		}

		const layer = await loadLayer(fileSystem, current, referrer);
		if (layer.isErr()) return layer;

		layers.push(layer.value);
		const { config, extendsLocation } = layer.value;
		if (config.extends === undefined || !extendsLocation) break;

		referrer = extendsLocation;
		current = path.resolve(path.dirname(current), config.extends);
	}

	return ok(mergeLayers(layers));
}

async function loadLayer(
	fileSystem: FileSystemService,
	file: string,
	referrer: DiagnosticLocation | undefined
): Promise<Result<Layer, Diagnostic[]>> {
	let text: string;
	try {
		text = await fileSystem.readFile(file);
	} catch (error) {
		const detail = ErrorUtils.fromUnknown(error).message;
		return err([
			referrer
				? Diagnostics.extendsUnreadable(referrer, file, detail)
				: Diagnostics.unreadable({ file, line: 1, column: 1 }, detail),
		]);
	}

	const parsed = parseConfig(text, file);
	if (parsed.isErr()) return parsed;
	return ok({ file, ...parsed.value });
}

function mergeLayers(layers: readonly Layer[]): CollapsedConfig {
	const [leaf] = layers;
	let merged: Omit<CollapsedConfig, "file" | "chain" | "outFile"> = {};

	for (const layer of [...layers].reverse()) {
		const { config } = layer;
		const dir = path.dirname(layer.file);
		const absolute = (value: string) => path.resolve(dir, value);

		merged = {
			...merged,
			...(config.rootDirs !== undefined && {
				rootDirs: config.rootDirs.map(absolute),
			}),
			...(config.exclude !== undefined && {
				exclude: config.exclude.map((glob) =>
					path.posix.join(toPosix(dir), glob)
				),
			}),
			...(config.template !== undefined && {
				template: absolute(config.template),
			}),
			...(config.syncDir !== undefined && {
				syncDir: absolute(config.syncDir),
			}),
			...((config.routes || merged.routes) && {
				routes: { ...merged.routes, ...config.routes },
			}),
			...((config.tags || merged.tags) && {
				tags: { ...merged.tags, ...config.tags },
			}),
		};
	}

	return {
		file: leaf.file,
		chain: layers.map((layer) => layer.file),
		...merged,
		...(leaf.config.outFile !== undefined && {
			outFile: path.resolve(path.dirname(leaf.file), leaf.config.outFile),
		}),
	};
}
