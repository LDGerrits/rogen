import { relativeTo } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { joinedWithOr } from "../../base/strings.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { ConfigService, CoveredTargets } from "../config/config-service.js";
import { Asked, WriteService } from "./write-service.js";

/** The paths given to `check` or `where`, each with the configs that answer for it. */
export class AskedPaths {
	private constructor(
		/** The arguments, a bare config name replaced by its file. */
		readonly args: readonly string[],
		/** One per argument, in order. */
		readonly asked: readonly Asked[],
		private readonly covering: CoveredTargets,
		/** For each uncovered argument, the configs beside it that read it. */
		private readonly readers: ReadonlyMap<number, readonly string[]>
	) {}

	static async of(
		configService: ConfigService,
		writeService: WriteService,
		cwd: string,
		given: readonly string[]
	): Promise<Result<AskedPaths, Error>> {
		const resolved = await configService.resolveNames(given);
		if (resolved.isErr()) return resolved;
		const args = resolved.value;
		const asked = await writeService.askedAbout({ args, cwd });
		const covering = await configService.selectCovering(
			asked.map((one) => ("path" in one ? one.path : undefined))
		);
		if (covering.isErr()) return covering;
		const readers = new Map<number, readonly string[]>();
		for (const index of covering.value.uncovered) {
			const one = asked[index];
			if ("path" in one)
				readers.set(index, await configService.readersOf(one.path));
		}
		return ok(new AskedPaths(args, asked, covering.value, readers));
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
			const readers = this.readers.get(index) ?? [];
			return "path" in one
				? [
						{
							path: one.path,
							reason: "noConfig",
							...(readers.length > 0 && { readers }),
						},
					]
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
	return Promise.all(
		skipped.map(async (one) => {
			const path = relativeTo(cwd, one.path);
			if (one.reason === "outsideSourcePaths")
				return `note: ${path}: in no source path of ${relativeTo(cwd, one.config ?? "")}, so Rogen leaves it out of the project file.`;
			const readers = one.readers ?? [];
			if (readers.length > 0) {
				// A folder asks about its own files only, so the command names the config file, which answers for the shared code too.
				const commands = readers.map(
					(file) => `'rogen ${ask.command} ${relativeTo(cwd, file)}'`
				);
				return readers.length === 1
					? `note: ${path}: no config at or above it reads it, but another config lists it in its source paths. ${ask.lead} through that config: ${commands[0]}.`
					: `note: ${path}: no config at or above it reads it, but other configs list it in their source paths. ${ask.lead} through one: ${joinedWithOr(commands)}.`;
			}
			const hint =
				named.length > 0
					? ` ${ask.lead} through one: rogen ${ask.command} ${joinedWithOr(named)}.`
					: "";
			return `note: ${path}: no config at or above it reads it.${hint}`;
		})
	);
}
