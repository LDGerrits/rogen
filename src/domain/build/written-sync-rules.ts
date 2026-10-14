import path from "path";
import { isGlobsetMatch, literalGlob } from "../../base/glob.js";
import { toPosix } from "../../base/path.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { SyncLayout } from "./sync-layout.js";

const GLOB_MAGIC = /[*?[\]{}]/;

/** The sync rules of a project as its written file carries them: each pattern moved to the folder and the sync path the file is written for, or one literal rule per file the rule takes when the moved pattern would miss one. */
export class WrittenSyncRules {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly layout: SyncLayout
	) {}

	/** `sources` are the absolute POSIX paths of the files the build scans. */
	of(sources: readonly string[]): SyncRule[] {
		return this.config.syncRules.own.flatMap((rule) => {
			const taken = sources.filter(
				(source) => this.config.fileAt(source).ownRule === rule
			);
			return this.moved(rule, taken) ?? this.literal(rule, taken);
		});
	}

	private landed(source: string): string {
		return this.layout.relativeToProject(this.layout.emittedPath(source));
	}

	/** The rule with its globs moved, when the moved rule still takes every file the rule takes. */
	private moved(
		rule: SyncRule,
		taken: readonly string[]
	): SyncRule[] | undefined {
		const pattern = this.movedGlob(rule.pattern, rule.origin);
		const exclude =
			rule.exclude === undefined
				? undefined
				: this.movedGlob(rule.exclude, rule.origin);
		if (pattern === undefined || (rule.exclude && exclude === undefined))
			return undefined;
		const takesAll = taken.every((source) => {
			const landed = this.landed(source);
			return (
				isGlobsetMatch(landed, pattern) &&
				!(exclude !== undefined && isGlobsetMatch(landed, exclude))
			);
		});
		if (!takesAll) return undefined;
		const { origin: _origin, ...written } = rule;
		return [
			{ ...written, pattern, ...(exclude !== undefined && { exclude }) },
		];
	}

	private literal(rule: SyncRule, taken: readonly string[]): SyncRule[] {
		return taken.map((source) => ({
			pattern: literalGlob(this.landed(source)),
			use: rule.use,
			...(rule.suffix !== undefined && { suffix: rule.suffix }),
		}));
	}

	/** A glob that begins with a wildcard takes the same files wherever they sit; one that begins with a folder name is moved with that folder; any other can't be moved. A moved glob is only kept when it still takes the files. */
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
