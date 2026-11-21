import { isGlobsetMatch, literalGlob } from "../../base/glob.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { SyncRule } from "../rojo/sync-rules.js";
import { ScannedFile } from "./root-scanner.js";
import { CompiledLayout } from "./compiled-layout.js";
import { WrittenGlobs } from "./written-globs.js";

export class WrittenSyncRules {
	constructor(
		private readonly config: ResolvedConfig,
		private readonly layout: CompiledLayout,
		private readonly globs: WrittenGlobs
	) {}

	of(entries: readonly ScannedFile[]): SyncRule[] {
		return this.config.syncRules.own.flatMap((rule) => {
			const taken = entries
				.filter(({ file }) => file.ownRule === rule)
				.map(({ source }) => source);
			return [
				...(this.moved(rule, taken) ?? this.literal(rule, taken)),
				...this.original(rule),
			];
		});
	}

	private landed(source: string): string {
		return this.layout.relativeToProject(this.layout.emittedPath(source));
	}

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
