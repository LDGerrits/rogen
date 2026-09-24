import path from "path";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import {
	ConfigFile,
	readConfigFile,
} from "../../platform/config/config-file.js";
import { UNREADABLE_CONFIG_CODE } from "../../platform/config/config-file-diagnostics.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";

export interface ConfigChain {
	/** The leaf first, then each parent. Includes a file that failed to load, so a watcher still sees it. */
	readonly files: readonly string[];
	readonly layers: readonly ConfigFile[];
	readonly diagnostics: readonly Diagnostic[];
}

export async function loadConfigChain(
	fileSystem: FileSystemService,
	file: string
): Promise<ConfigChain> {
	const files: string[] = [];
	const layers: ConfigFile[] = [];
	let current = file;
	let referrer: DiagnosticLocation | undefined;

	for (;;) {
		const cycleStart = files.indexOf(current);
		if (cycleStart >= 0 && referrer) {
			const cycle = [...files.slice(cycleStart), current];
			return {
				files,
				layers,
				diagnostics: [
					ConfigDiagnostics.extendsCycle(referrer, cycle),
				],
			};
		}

		files.push(current);
		const loaded = await readConfigFile(fileSystem, current);
		if (loaded.isErr()) {
			const from = referrer;
			const target = current;
			return {
				files,
				layers,
				diagnostics: loaded.error.map((diagnostic) =>
					from && diagnostic.code === UNREADABLE_CONFIG_CODE
						? ConfigDiagnostics.extendsUnreadable(
								from,
								target,
								diagnostic.message
							)
						: diagnostic
				),
			};
		}

		const layer = loaded.value;
		layers.push(layer);
		const parent = layer.model.getValue<string>("extends");
		if (parent === undefined) return { files, layers, diagnostics: [] };

		referrer = {
			resource: layer.file,
			position: layer.positionOf("extends"),
		};
		current = path.resolve(path.dirname(current), parent);
	}
}
