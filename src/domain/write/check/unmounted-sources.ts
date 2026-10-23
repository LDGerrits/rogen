import path from "path";
import { ignoringGlob } from "../../../base/glob.js";
import { contains, joinPosix, toPosix } from "../../../base/path.js";
import { plural } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { isDirectoryType } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoFile } from "../../rojo/rojo.js";
import { rojoPathTarget } from "../../rojo/rojo-project.js";

/** Finds the files Rojo reads in the folder a config without routes would have scanned, which go unsynced unless its tree mounts them; a nested project in the tree may mount what lies in its folder. */
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
			)
			.map((mount) =>
				RojoFile.at(toPosix(mount), this.config.syncRules).isProject
					? path.dirname(mount)
					: mount
			);
		const loose = this.filesIn(defaultPath).filter(
			(file) =>
				RojoFile.at(toPosix(file), this.config.syncRules).kind !==
					undefined &&
				!mounts.some((mount) => contains(mount, file)) &&
				ignoringGlob(file, this.config.ignored) === undefined
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

	private filesIn(dir: string): string[] {
		const entries = this.index.getEntries(dir);
		if (!entries) return [];
		return [...entries].flatMap(([name, type]) => {
			const child = joinPosix(dir, name);
			return isDirectoryType(type) ? this.filesIn(child) : [child];
		});
	}
}
