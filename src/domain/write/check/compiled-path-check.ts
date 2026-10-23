import path from "path";
import { ancestors, stemOf, toPosix } from "../../../base/path.js";
import { listLimited } from "../../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	FileReader,
	FileType,
	isDirectoryType,
	isFileType,
} from "../../../platform/fs/file-system-service.js";
import { RojoFile } from "../../rojo/rojo.js";
import { MetaReplacement } from "../../toolchain/toolchain.js";
import { Placement } from "../placement.js";
import { CompiledLayout } from "../compiled-layout.js";

const LISTED_PATHS = 3;

/** A compiled file's path with `.luau` read as `.lua`, since a processor may write either. */
const compiledKey = (file: string): string => file.replace(/\.luau$/, ".lua");

interface EmittedTops {
	readonly paths: readonly string[];
	readonly synced: boolean;
}

interface CompiledPathRun {
	readonly placement: Placement;
	readonly compiledPath: string;
	readonly emittedTops: ReadonlyMap<string, EmittedTops>;
}

/** Checks what the compiled path holds against what the write expects there, which only changes when the compiler runs. */
export class CompiledPathCheck {
	constructor(private readonly fileSystemService: FileReader) {}

	async check(placement: Placement): Promise<Diagnostic[]> {
		const { compiledPath } = placement.layout;
		if (compiledPath === undefined) return [];
		const run: CompiledPathRun = {
			placement,
			compiledPath,
			emittedTops: await this.emittedTops(placement),
		};
		return [
			...(await this.nothingEmitted(run)),
			...(await this.metaNotSynced(run)),
			...(await this.dataFileConverted(run)),
			...(await this.orphanCompiledFiles(run)),
		];
	}

	private async emittedTops({
		config,
		layout,
	}: Placement): Promise<ReadonlyMap<string, EmittedTops>> {
		const tops = new Map<string, EmittedTops>();
		for (const sourcePath of config.sourcePaths) {
			const paths = await this.topLevelEmitted(sourcePath, layout);
			tops.set(sourcePath, {
				paths,
				synced: await this.anyExists(paths),
			});
		}
		return tops;
	}

	private async nothingEmitted({
		placement: { config, layout },
		compiledPath,
		emittedTops,
	}: CompiledPathRun): Promise<Diagnostic[]> {
		const shown = (target: string) =>
			layout.relativeToProject(target) || ".";
		const warnings: Diagnostic[] = [];

		if (
			!(await this.fileSystemService.isDirectory(compiledPath)) &&
			[...emittedTops.values()].some(({ paths }) => paths.length > 0)
		)
			return [
				warningDiagnostic(
					"output.nothingEmitted",
					{ resource: compiledPath },
					`the compiled path "${shown(compiledPath)}" doesn't exist yet, so Rojo has nothing to sync. Run your compiler or processor first.`
				),
			];

		for (const sourcePath of config.sourcePaths) {
			const tops = emittedTops.get(sourcePath);
			if (!tops || tops.paths.length === 0 || tops.synced) continue;
			const emitted = tops.paths;

			const expected = path.join(
				compiledPath,
				path.relative(layout.commonRoot, sourcePath)
			);
			const found = await this.findShifted(compiledPath, emitted[0]);
			const nearest = found
				? `Found "${shown(found)}" — is the output of your compiler or processor rooted differently?`
				: `The nearest path that exists is "${shown(await this.nearestExisting(expected))}" — has your compiler or processor run?`;
			warnings.push(
				warningDiagnostic(
					"output.nothingEmitted",
					{ resource: sourcePath },
					`nothing emitted for source path "${shown(sourcePath)}" exists under "${shown(expected)}". ${nearest}`
				)
			);
		}
		return warnings;
	}

	private async metaNotSynced({
		placement,
		compiledPath,
		emittedTops,
	}: CompiledPathRun): Promise<Diagnostic[]> {
		const { config, layout } = placement;
		const unclaimed = new Set(
			placement.unclaimedMeta().map(({ path }) => path)
		);
		const replacements = layout.metaReplacements;

		const missing: string[] = [];
		let converted = 0;
		let conversion: MetaReplacement | undefined;

		for (const { sourcePath, file: source } of placement.metaFiles) {
			if (!emittedTops.get(sourcePath)?.synced) continue;
			if (unclaimed.has(toPosix(source))) continue;
			const emitted = layout.emittedPath(source);
			if (await this.fileSystemService.exists(emitted)) continue;
			missing.push(toPosix(source));
			const replacement = await this.replacementAt(
				emitted.slice(
					0,
					-(
						emitted.endsWith(RojoFile.META_SUFFIX_JSONC)
							? RojoFile.META_SUFFIX_JSONC
							: RojoFile.META_SUFFIX
					).length
				),
				replacements
			);
			if (replacement) {
				conversion ??= replacement;
				if (replacement === conversion) converted++;
			}
		}
		if (missing.length === 0) return [];

		const them = missing.length === 1 ? "it" : "them";
		const cause = conversion
			? `The processor turned ${converted === missing.length ? them : `${converted} of them`} into ${conversion.suffix}, which Rojo syncs as a ModuleScript instead of applying. ${conversion.note}`
			: "Have the compiler or processor copy .meta.json files into its output.";
		return [
			warningDiagnostic(
				"output.metaNotSynced",
				{ resource: config.projectFile },
				`${missing.length} meta ${missing.length === 1 ? "file has" : "files have"} no copy under "${layout.relativeToProject(compiledPath) || "."}" (${listLimited(missing, LISTED_PATHS)}), so Rojo doesn't apply ${them}. ${cause}`
			),
		];
	}

	private async dataFileConverted({
		placement,
		compiledPath,
		emittedTops,
	}: CompiledPathRun): Promise<Diagnostic[]> {
		const { config, layout, files } = placement;
		const replacements = layout.dataReplacements;
		if (replacements.length === 0) return [];
		const converted: {
			source: string;
			expected: string;
			found: string;
			note: string;
		}[] = [];
		for (const { entry } of files) {
			if (entry.kind !== "data") continue;
			if (!emittedTops.get(entry.sourcePath)?.synced) continue;

			const expected = layout.emittedPath(
				path.join(entry.sourcePath, entry.relativePath)
			);
			if (await this.fileSystemService.exists(expected)) continue;
			const base = stemOf(expected);
			const replacement = await this.replacementAt(base, replacements);
			if (replacement)
				converted.push({
					source: entry.source,
					expected,
					found: `${base}${replacement.suffix}`,
					note: replacement.note,
				});
		}
		if (converted.length === 0) return [];

		const shown = (target: string) => layout.relativeToProject(target);
		const [{ note }] = converted;
		const many = converted.length > 1;
		const listed = listLimited(
			converted.map(
				({ source, expected, found }) =>
					`${layout.relativeToProject(source)}: expected "${shown(expected)}", found "${shown(found)}"`
			),
			LISTED_PATHS
		);
		return [
			warningDiagnostic(
				"output.dataFileConverted",
				{ resource: config.projectFile },
				`${converted.length} data ${many ? "files were" : "file was"} turned into ${many ? "Lua modules" : "a Lua module"} under "${shown(compiledPath) || "."}" (${listed}). Rojo finds nothing at the path the build expects, or a ModuleScript where a folder collapses. ${note} Copy the data files unchanged into the compiled path after it runs, or require them as modules.`
			),
		];
	}

	private async orphanCompiledFiles({
		placement: { config, layout },
		emittedTops,
	}: CompiledPathRun): Promise<Diagnostic[]> {
		const orphans = new Map<string, string[]>();
		for (const sourcePath of config.sourcePaths) {
			if (!emittedTops.get(sourcePath)?.synced) continue;
			const compiledDir = layout.emittedPath(sourcePath);
			if (!(await this.fileSystemService.isDirectory(compiledDir)))
				continue;
			const made = await this.madeBy(sourcePath, layout);
			for (const file of await this.filesUnder(compiledDir, true)) {
				if (made.has(compiledKey(file))) continue;
				if (
					!RojoFile.at(toPosix(file), config.syncRules).isSyncedByRojo
				)
					continue;
				const dir = path.dirname(file);
				const listed = orphans.get(dir) ?? [];
				if (!listed.includes(file)) orphans.set(dir, [...listed, file]);
			}
		}

		return [...orphans].map(([dir, files]) => {
			const shown = files.map((file) => layout.relativeToProject(file));
			const many = files.length > 1;
			return warningDiagnostic(
				"compiled.orphan",
				{ resource: dir },
				`${listLimited(shown, LISTED_PATHS)} ${many ? "are" : "is"} in the compiled path and no source file makes ${many ? "them" : "it"}, so Rojo may still sync ${many ? "them" : "it"}. Delete ${many ? "them" : "it"}, or compile again from a clean folder.`
			);
		});
	}

	/** The compiled keys of everything the files under `sourcePath` can produce, by whatever name a tool gives them. */
	private async madeBy(
		sourcePath: string,
		layout: CompiledLayout
	): Promise<Set<string>> {
		const made = new Set<string>();
		for (const source of await this.filesUnder(sourcePath, false)) {
			const emitted = layout.emittedPath(source);
			made.add(compiledKey(emitted));
			for (const { suffix } of layout.dataReplacements)
				made.add(compiledKey(`${stemOf(emitted)}${suffix}`));
			for (const { suffix } of layout.metaReplacements)
				for (const metaSuffix of [
					RojoFile.META_SUFFIX,
					RojoFile.META_SUFFIX_JSONC,
				])
					if (emitted.endsWith(metaSuffix))
						made.add(
							compiledKey(
								`${emitted.slice(0, -metaSuffix.length)}${suffix}`
							)
						);
		}
		return made;
	}

	/** Every file under `dir`, folders and hidden entries of a compiled folder skipped as asked; links are not followed. */
	private async filesUnder(
		dir: string,
		skipHidden: boolean
	): Promise<string[]> {
		const files: string[] = [];
		for (const [name, type] of await this.fileSystemService.readDirectory(
			dir
		)) {
			if (skipHidden && name.startsWith(".")) continue;
			const child = path.join(dir, name);
			if ((type & FileType.SymbolicLink) !== 0) continue;
			if (isDirectoryType(type))
				files.push(...(await this.filesUnder(child, skipHidden)));
			else if (isFileType(type)) files.push(child);
		}
		return files;
	}

	private async replacementAt<T extends { readonly suffix: string }>(
		stem: string,
		replacements: readonly T[]
	): Promise<T | undefined> {
		for (const replacement of replacements)
			if (
				await this.fileSystemService.exists(
					`${stem}${replacement.suffix}`
				)
			)
				return replacement;
		return undefined;
	}

	private async topLevelEmitted(
		sourcePath: string,
		layout: CompiledLayout
	): Promise<string[]> {
		if (!(await this.fileSystemService.isDirectory(sourcePath))) return [];
		return (await this.fileSystemService.readDirectory(sourcePath))
			.filter(([name]) => !name.startsWith("."))
			.map(([name]) => layout.emittedPath(path.join(sourcePath, name)));
	}

	private async anyExists(paths: readonly string[]): Promise<boolean> {
		for (const target of paths)
			if (await this.fileSystemService.exists(target)) return true;
		return false;
	}

	private async findShifted(
		compiledPath: string,
		emitted: string
	): Promise<string | undefined> {
		const segments = path.relative(compiledPath, emitted).split(path.sep);
		const candidates = segments
			.slice(1)
			.map((_, index) =>
				path.join(compiledPath, ...segments.slice(index + 1))
			);

		if (await this.fileSystemService.isDirectory(compiledPath)) {
			for (const [
				name,
				type,
			] of await this.fileSystemService.readDirectory(compiledPath))
				if (isDirectoryType(type))
					candidates.push(path.join(compiledPath, name, ...segments));
		}

		for (const candidate of candidates)
			if (await this.fileSystemService.exists(candidate))
				return candidate;
		return undefined;
	}

	private async nearestExisting(target: string): Promise<string> {
		const chain = [target, ...ancestors(target)];
		for (const dir of chain)
			if (await this.fileSystemService.exists(dir)) return dir;
		return chain[chain.length - 1];
	}
}
