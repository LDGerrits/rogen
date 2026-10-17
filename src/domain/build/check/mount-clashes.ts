import path from "path";
import { ignoringAllOf, ignoringGlob } from "../../../base/glob.js";
import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	DiagnosticRelated,
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

	/** One warning for each mount that a route puts files beside a name of. */
	async diagnostics(placement: Placement): Promise<Diagnostic[]> {
		const { config } = placement;
		const found: Diagnostic[] = [];
		for (const mount of placement.tree.mounts.all) {
			const held = await this.namesIn(mount.path, placement);
			if (held.size === 0) continue;
			const clashing = placement.files.flatMap(
				({ entry, instancePath }) => {
					const name = instancePath[mount.node.length];
					return name !== undefined &&
						held.has(name) &&
						mount.node.every(
							(part, at) => instancePath[at] === part
						)
						? [{ source: entry.source, instancePath, name }]
						: [];
				}
			);
			if (clashing.length === 0) continue;
			const shown = toPosix(
				path.relative(path.dirname(config.file), mount.path)
			);
			const where = `the mount of ${shown} at "${instanceKey(mount.node)}"`;
			const names = [...new Set(clashing.map(({ name }) => name))];
			const many = clashing.length > 1;
			const related: DiagnosticRelated[] = clashing.map(
				({ source, name }) => ({
					resource: source,
					message: `makes a "${name}" next to the "${name}" that ${where} holds`,
				})
			);
			found.push(
				warningDiagnostic(
					"tree.mountClash",
					{ resource: config.file },
					[
						`${clashing.length} ${many ? "files sit" : "file sits"} next to ${names.length > 1 ? "instances" : "an instance"} of the same name that ${where} holds, so Rojo builds two of ${names.length > 1 ? "each" : "it"}:`,
						...clashing.map(
							({ source, instancePath, name }) =>
								`  ${source} -> ${instanceKey(instancePath)} (next to "${name}")`
						),
						`Rename one of ${many ? "each pair" : "them"}, or route outside the mounted folder.`,
					].join("\n"),
					[],
					related
				)
			);
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
