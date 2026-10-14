import path from "path";
import { isMatch } from "../../base/glob.js";
import { contains, joinPosix } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { isDirectoryType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoFile } from "../rojo/rojo.js";
import { rojoPathTarget } from "../rojo/rojo-project.js";

/** A config without routes routes nothing and scans no source path, so the files Rojo reads in the folder it would have scanned go unsynced unless its tree mounts them. */
export class UnmountedSources {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly index: IndexReader
	) {}

	diagnostics(): Diagnostic[] {
		if (this.config.routes.size > 0) return [];
		const [defaultPath] = this.config.indexedPaths;
		const mounts = this.config.project
			.mountedPaths()
			.map(({ path: mounted }) =>
				path.resolve(this.config.projectDir, rojoPathTarget(mounted))
			);
		const loose = this.filesIn(defaultPath).filter(
			(file) =>
				new RojoFile(path.basename(file)).kind !== undefined &&
				!mounts.some((mount) => contains(mount, file)) &&
				!this.config.ignored.some((glob) => isMatch(file, glob))
		);
		return loose.length === 0
			? []
			: [
					warningDiagnostic(
						"scan.unmountedSource",
						{ resource: defaultPath },
						`${plural(loose.length, "file")} here ${loose.length === 1 ? "is" : "are"} mounted by nothing in the tree, and the config declares no routes, so Rojo never syncs ${loose.length === 1 ? "it" : "them"}. Add "routes" to place them, or mount the folder with "$path".`
					),
				];
	}

	/** Every file below `dir`, as POSIX paths. */
	private filesIn(dir: string): string[] {
		const entries = this.index.getEntries(dir);
		if (!entries) return [];
		return [...entries].flatMap(([name, type]) => {
			const child = joinPosix(dir, name);
			return isDirectoryType(type) ? this.filesIn(child) : [child];
		});
	}
}
