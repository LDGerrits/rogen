import path from "path";
import { negationOf } from "../../base/glob.js";
import { containsPosix, toPosix } from "../../base/path.js";
import { CompiledLayout } from "./compiled-layout.js";

const GLOB_MAGIC = /[*?[\]{}]/;

export class WrittenGlobs {
	constructor(
		private readonly layout: CompiledLayout,
		private readonly mounts: readonly string[]
	) {}

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

	moved(glob: string, from?: string): string | undefined {
		if (this.isAbsolute(glob) || glob.startsWith("*")) return glob;
		const inProject = this.inProject(glob, from);
		if (this.layout.compiled.folder === undefined) return inProject;
		if (GLOB_MAGIC.test(glob.split("/")[0])) return undefined;
		return this.layout.syncedGlob(inProject);
	}

	original(glob: string, from?: string): string | undefined {
		if (this.isAbsolute(glob) || glob.startsWith("*")) return undefined;
		const inProject = this.inProject(glob, from);
		return this.moved(glob, from) !== inProject &&
			this.reachesMount(inProject)
			? inProject
			: undefined;
	}

	inProject(glob: string, from?: string): string {
		if (this.isAbsolute(glob) || from === undefined) return glob;
		const prefix = path.posix.relative(
			toPosix(this.layout.compiled.projectDir),
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
			toPosix(this.layout.compiled.projectDir),
			...(magic === -1 ? segments : segments.slice(0, magic))
		);
		return this.mounts.some(
			(mount) => containsPosix(mount, base) || containsPosix(base, mount)
		);
	}
}
