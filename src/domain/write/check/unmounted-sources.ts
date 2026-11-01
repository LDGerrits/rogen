import path from "path";
import { ignoringGlob } from "../../../base/glob.js";
import { contains, joinPosix, toPosix } from "../../../base/path.js";
import { compareStrings } from "../../../base/collections.js";
import { listLimited, plural } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { isDirectoryType } from "../../../platform/fs/file-system-service.js";
import { IndexReader } from "../../../platform/fs/index-service.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import { RojoFile } from "../../rojo/rojo.js";
import { rojoPathTarget } from "../../rojo/rojo-project.js";

const LISTED_PATHS = 3;

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
		const loose = this.filesIn(defaultPath)
			.filter(
				(file) =>
					RojoFile.at(toPosix(file), this.config.syncRules).kind !==
						undefined &&
					!mounts.some((mount) => contains(mount, file)) &&
					ignoringGlob(file, this.config.ignored) === undefined
			)
			.sort(compareStrings);
		const listed = listLimited(
			loose.map((file) =>
				path.posix.relative(toPosix(defaultPath), file)
			),
			LISTED_PATHS
		);
		return loose.length === 0
			? []
			: [
					warningDiagnostic(
						"scan.unmountedSource",
						{ resource: defaultPath },
						`${plural(loose.length, "file")} here ${loose.length === 1 ? "is" : "are"} mounted by nothing in the tree (${listed}), and the config declares no routes, so Rojo never syncs ${loose.length === 1 ? "it" : "them"}. Add "routes" to place them, or mount the folder with "$path".`,
						[],
						loose.map((resource) => ({
							resource,
							message: "mounted by nothing in the tree",
						}))
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
