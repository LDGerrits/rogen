import { isGlobsetMatch, literalGlob } from "../../base/glob.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { ScannedFile } from "./root-scanner.js";
import { CompiledLayout } from "./compiled-layout.js";
import { WrittenGlobs } from "./written-globs.js";

/** The sync rules as the written file carries them, moved to where the file's folders are so Rojo reads the files Rogen did. */
export class WrittenSyncRules {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly layout: CompiledLayout,
		private readonly globs: WrittenGlobs
	) {}

	of(
		entries: readonly ScannedFile[],
		legacyClients: ReadonlySet<string>
	): SyncRule[] {
		const own = this.config.syncRules.own.flatMap((rule) => {
			const taken = entries
				.filter(({ file }) => file.ownRule === rule)
				.map(({ source }) => source);
			return [
				...(this.moved(rule, taken) ?? this.literal(rule, taken)),
				...this.original(rule),
			];
		});
		return [...own, ...this.legacyClient(legacyClients)];
	}

	/** One rule per client script that stays a LocalScript, since a rule applies to every file it matches. */
	private legacyClient(sources: ReadonlySet<string>): SyncRule[] {
		return [...sources].flatMap((source) => {
			const landed = this.landed(source);
			const suffix = /\.client\.[^.]+$/.exec(landed)?.[0];
			return suffix === undefined
				? []
				: [
						{
							pattern: literalGlob(landed),
							use: "legacyClientScript" as const,
							suffix,
						},
					];
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
		const from = this.config.syncRules.dir;
		const pattern = this.globs.moved(rule.pattern, from);
		const exclude =
			rule.exclude === undefined
				? undefined
				: this.globs.moved(rule.exclude, from);
		if (pattern === undefined || (rule.exclude && exclude === undefined))
			return undefined;
		const takesAll = taken.every((source) => {
			const landed = this.landed(source);
			return (
				isGlobsetMatch(landed, pattern) &&
				!(exclude !== undefined && isGlobsetMatch(landed, exclude))
			);
		});
		return takesAll
			? [{ ...rule, pattern, ...(exclude !== undefined && { exclude }) }]
			: undefined;
	}

	private literal(rule: SyncRule, taken: readonly string[]): SyncRule[] {
		return taken.map((source) => ({
			pattern: literalGlob(this.landed(source)),
			use: rule.use,
			...(rule.suffix !== undefined && { suffix: rule.suffix }),
		}));
	}

	/** The rule as it is in the project, for the files a mount brings in under the pattern's old place. */
	private original(rule: SyncRule): SyncRule[] {
		const from = this.config.syncRules.dir;
		const pattern = this.globs.original(rule.pattern, from);
		if (pattern === undefined) return [];
		const exclude =
			rule.exclude === undefined
				? undefined
				: this.globs.inProject(rule.exclude, from);
		return [
			{ ...rule, pattern, ...(exclude !== undefined && { exclude }) },
		];
	}
}
