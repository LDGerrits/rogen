import path from "path";
import { literalGlob } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { SyncLayout } from "./sync-layout.js";

const GLOB_MAGIC = /[*?[\]{}]/;

/** The sync rules of a project as its written file carries them: each pattern moved to the folder and the sync path the file is written for, or one literal rule per file the pattern takes when it can't be moved. */
export class WrittenSyncRules {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly layout: SyncLayout
	) {}

	/** `sources` are the absolute POSIX paths of the files the build scans. */
	of(sources: readonly string[]): SyncRule[] {
		return this.config.syncRules.own.flatMap(
			(rule) => this.moved(rule) ?? this.literal(rule, sources)
		);
	}

	private moved(rule: SyncRule): SyncRule[] | undefined {
		const pattern = this.movedGlob(rule.pattern, rule.origin);
		const exclude =
			rule.exclude === undefined
				? undefined
				: this.movedGlob(rule.exclude, rule.origin);
		if (pattern === undefined || (rule.exclude && exclude === undefined))
			return undefined;
		const { origin: _origin, ...written } = rule;
		return [
			{ ...written, pattern, ...(exclude !== undefined && { exclude }) },
		];
	}

	private literal(rule: SyncRule, sources: readonly string[]): SyncRule[] {
		return sources
			.filter((source) => this.config.fileAt(source).ownRule === rule)
			.map((source) => ({
				pattern: literalGlob(
					this.layout.relativeToProject(
						this.layout.emittedPath(source)
					)
				),
				use: rule.use,
				...(rule.suffix !== undefined && { suffix: rule.suffix }),
			}));
	}

	/** A glob that begins with a wildcard takes the same files wherever they sit; one that begins with a folder name is moved with that folder; any other can't be moved. */
	private movedGlob(
		glob: string,
		origin: string | undefined
	): string | undefined {
		if (path.posix.isAbsolute(glob) || path.win32.isAbsolute(glob))
			return glob;
		if (glob.startsWith("*")) return glob;
		const prefix =
			origin === undefined
				? ""
				: path.posix.relative(toPosix(this.layout.projectDir), origin);
		if (prefix === "" && this.layout.syncPath === undefined) return glob;
		if (GLOB_MAGIC.test(glob.split("/")[0])) return undefined;
		return this.layout.syncedGlob(
			prefix === "" ? glob : path.posix.join(prefix, glob)
		);
	}
}
