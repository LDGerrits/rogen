import { relativeTo } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { joinedWithOr } from "../../base/strings.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { ConfigService, CoveredTargets } from "../config/config-service.js";
import { Asked, BuildService } from "./build-service.js";

/** The paths given to `check` or `where`, each with the configs that answer for it. */
export class AskedPaths {
	private constructor(
		/** The arguments, a bare config name replaced by its file. */
		readonly args: readonly string[],
		/** One per argument, in order. */
		readonly asked: readonly Asked[],
		private readonly covering: CoveredTargets
	) {}

	static async of(
		configService: ConfigService,
		buildService: BuildService,
		cwd: string,
		given: readonly string[]
	): Promise<Result<AskedPaths, Error>> {
		const resolved = await configService.resolveNames(given);
		if (resolved.isErr()) return resolved;
		const args = resolved.value;
		const asked = await buildService.askedAbout({ args, cwd });
		const covering = await configService.selectCovering(
			asked.map((one) => ("path" in one ? one.path : undefined))
		);
		return covering.map((covered) => new AskedPaths(args, asked, covered));
	}

	/** One per config that answers, with the indexes of the arguments it answers for. */
	get groups(): CoveredTargets["groups"] {
		return this.covering.groups;
	}

	/** The arguments at `indexes`. */
	argsAt(indexes: readonly number[]): string[] {
		return indexes.map((index) => this.args[index]);
	}

	/** What was asked about that a config answers for. */
	get covered(): Asked[] {
		const uncovered = new Set(this.covering.uncovered);
		return this.asked.filter((_, index) => !uncovered.has(index));
	}

	/** The paths no config is at or above. */
	get uncovered(): SkippedPath[] {
		return this.covering.uncovered.flatMap((index): SkippedPath[] => {
			const one = this.asked[index];
			return "path" in one
				? [{ path: one.path, reason: "noConfig" }]
				: [];
		});
	}
}

/** What a command says of each skipped path; `ask` words the way to ask instead through a named config of the working folder, which `noConfig` offers. */
export async function skippedNotes(
	configService: ConfigService,
	skipped: readonly SkippedPath[],
	cwd: string,
	ask: { readonly command: string; readonly lead: string }
): Promise<string[]> {
	const named = skipped.some(({ reason }) => reason === "noConfig")
		? (await configService.namedConfigs()).map((file) =>
				relativeTo(cwd, file)
			)
		: [];
	return skipped.map((one) => {
		const path = relativeTo(cwd, one.path);
		if (one.reason === "outsideSourcePaths")
			return `note: ${path}: in no source path of ${relativeTo(cwd, one.config ?? "")}, so no build reads it.`;
		const hint =
			named.length > 0
				? ` ${ask.lead} through one: rogen ${ask.command} ${joinedWithOr(named)}.`
				: "";
		return `note: ${path}: no config at or above it reads it.${hint}`;
	});
}
