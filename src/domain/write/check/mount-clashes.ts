import path from "path";
import { ignoringAllOf, ignoringGlob } from "../../../base/glob.js";
import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	isDirectoryType,
} from "../../../platform/fs/file-system-service.js";
import { instanceKey } from "../../roblox/roblox.js";
import { RojoFile } from "../../rojo/rojo.js";
import { Placement } from "../placement.js";

/** Finds the placed files that would sit next to an instance of the same name that a `$path` mount of the tree already holds, which Rojo builds twice. */
export class MountClashes {
	constructor(private readonly fileReader: FileReader) {}

	/** One warning for each placed file that sits beside a name a mount holds. */
	async diagnostics(placement: Placement): Promise<Diagnostic[]> {
		const { config } = placement;
		const found: Diagnostic[] = [];
		for (const mount of placement.tree.mounts.all) {
			const held = await this.namesIn(mount.path, placement);
			if (held.size === 0) continue;
			const shown = toPosix(
				path.relative(path.dirname(config.file), mount.path)
			);
			const where = `the mount of ${shown} at "${instanceKey(mount.node)}"`;
			for (const { entry, instancePath } of placement.files) {
				const name = instancePath[mount.node.length];
				if (
					name !== undefined &&
					held.has(name) &&
					mount.node.every((part, at) => instancePath[at] === part)
				)
					found.push(
						warningDiagnostic(
							"tree.mountClash",
							{ resource: entry.source },
							`makes a "${name}" next to the "${name}" that ${where} holds`
						)
					);
			}
		}
		return found;
	}

	/** The names of the instances Rojo reads from the folder at `directory`, leaving out what the config ignores. */
	private async namesIn(
		directory: string,
		{ config }: Placement
	): Promise<Set<string>> {
		const posix = toPosix(directory);
		if (!(await this.fileReader.isDirectory(posix))) return new Set();
		const names = new Set<string>();
		for (const [entry, type] of await this.fileReader.readDirectory(
			posix
		)) {
			const full = path.posix.join(posix, entry);
			if (
				(ignoringGlob(full, config.ignored) ??
					ignoringAllOf(full, config.ignored)) !== undefined
			)
				continue;
			if (isDirectoryType(type)) {
				names.add(entry);
				continue;
			}
			const file = RojoFile.at(full, config.syncRules);
			if (
				file.kind !== undefined &&
				!file.isInit &&
				!file.isDefaultProject &&
				!file.isProject
			)
				names.add(file.instanceName);
		}
		return names;
	}
}
