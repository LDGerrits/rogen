import { relativeTo, samePath } from "../../base/path.js";
import { Result, ok } from "../../base/result.js";
import { joinedWithOr } from "../../base/strings.js";
import { SkippedPath } from "../../platform/diagnostics/skipped-path.js";
import { ConfigService, CoveredTargets } from "../config/config-service.js";
import { Asked, WriteService } from "./write-service.js";

export class AskedPaths {
	private constructor(
		readonly args: readonly string[],
		readonly asked: readonly Asked[],
		private readonly covering: CoveredTargets,
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
		for (const index of covering.value.uncovered)
			readers.set(
				index,
				await configService.readersOf(AskedPaths.pathAt(asked, index))
			);
		return ok(new AskedPaths(args, asked, covering.value, readers));
	}

	private static pathAt(asked: readonly Asked[], index: number): string {
		return (asked[index] as { readonly path: string }).path;
	}

	get groups(): CoveredTargets["groups"] {
		return this.covering.groups;
	}

	argsAt(indexes: readonly number[]): string[] {
		return indexes.map((index) => this.args[index]);
	}

	get covered(): Asked[] {
		const uncovered = new Set(this.covering.uncovered);
		return this.asked.filter((_, index) => !uncovered.has(index));
	}

	get uncovered(): SkippedPath[] {
		const named = this.asked.flatMap((one) =>
			"path" in one ? [one.path] : []
		);
		const readByNamed = (index: number) =>
			this.readers
				.get(index)!
				.some((reader) => named.some((one) => samePath(one, reader)));
		return this.covering.uncovered
			.filter((index) => !readByNamed(index))
			.map((index): SkippedPath => {
				const readers = this.readers.get(index)!;
				return {
					path: AskedPaths.pathAt(this.asked, index),
					reason: "noConfig",
					...(readers.length > 0 && { readers }),
				};
			});
	}
}

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
				return `note: ${path}: in no source path of ${relativeTo(cwd, one.config!)}, so Rogen leaves it out of the project file.`;
			const readers = one.readers ?? [];
			if (readers.length > 0) {
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
