import path from "path";
import { negationOf } from "../../base/glob.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { SyncLayout } from "./sync-layout.js";

const GLOB_MAGIC = /[*?[\]{}]/;

/** The globs of a project as its written file carries them: moved under the sync path, and kept as they were where the tree mounts a folder the move leaves behind. */
export class WrittenGlobs {
	/** `mounts` are the absolute POSIX paths the tree mounts. */
	constructor(
		private readonly layout: SyncLayout,
		private readonly mounts: readonly string[]
	) {}

	/** The globs for `glob` ahead of the sync path's move; `from` is the absolute POSIX folder it is relative to, when that is not the project's own. */
	of(glob: string, from?: string): string[] {
		const { negated, body } = negationOf(glob);
		if (negated) return this.of(body, from).map((each) => `!${each}`);
		const written = [
			this.moved(glob, from) ?? this.inProject(glob, from),
			this.original(glob, from),
		];
		return written.filter(
			(each, at): each is string =>
				each !== undefined && written.indexOf(each) === at
		);
	}

	/** A glob that begins with a wildcard takes the same files wherever they sit; one that begins with a folder name is moved with that folder; any other can't be moved. */
	moved(glob: string, from?: string): string | undefined {
		if (this.isAbsolute(glob) || glob.startsWith("*")) return glob;
		const inProject = this.inProject(glob, from);
		if (this.layout.syncPath === undefined) return inProject;
		if (GLOB_MAGIC.test(glob.split("/")[0])) return undefined;
		return this.layout.syncedGlob(inProject);
	}

	/** The glob as it is in the project, when a mount lies where it reaches and the move would leave that mount without it. */
	original(glob: string, from?: string): string | undefined {
		if (this.isAbsolute(glob) || glob.startsWith("*")) return undefined;
		const inProject = this.inProject(glob, from);
		return this.moved(glob, from) !== inProject &&
			this.reachesMount(inProject)
			? inProject
			: undefined;
	}

	/** The glob as the project writes it, relative to the project's own folder. */
	inProject(glob: string, from?: string): string {
		if (this.isAbsolute(glob) || from === undefined) return glob;
		const prefix = path.posix.relative(
			toPosix(this.layout.projectDir),
			from
		);
		return prefix === "" ? glob : path.posix.join(prefix, glob);
	}

	private isAbsolute(glob: string): boolean {
		return path.posix.isAbsolute(glob) || path.win32.isAbsolute(glob);
	}

	private reachesMount(glob: string): boolean {
		const segments = glob.split("/");
		const magic = segments.findIndex((segment) => GLOB_MAGIC.test(segment));
		const base = path.posix.join(
			toPosix(this.layout.projectDir),
			...(magic === -1 ? segments : segments.slice(0, magic))
		);
		return this.mounts.some(
			(mount) => containsPosix(mount, base) || containsPosix(base, mount)
		);
	}
}
