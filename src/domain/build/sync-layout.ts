import path from "path";
import { ancestors, toPosix } from "../../base/path.js";
import { listLimited } from "../../base/string.js";
import { warningDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { OptionalRojoPath } from "../rojo/rojo-project.js";
import { MetaReplacement, SyncTool } from "../toolchain/toolchain.js";
import { Placement } from "./placement.js";

/** Where a build's files are synced from: the root dirs themselves, or the `syncDir` that tools write them into. */
export class SyncLayout {
	readonly commonRoot: string;
	readonly syncDir: string | undefined;
	readonly projectDir: string;

	/** `tools` are what rewrites code on its way to `syncDir`. */
	constructor(
		config: Pick<ResolvedConfig, "commonRoot" | "syncDir" | "projectDir">,
		private readonly tools: readonly SyncTool[]
	) {
		this.commonRoot = config.commonRoot ?? config.projectDir;
		this.syncDir = config.syncDir;
		this.projectDir = config.projectDir;
	}

	get isSynced(): boolean {
		return this.syncDir !== undefined;
	}

	/** What the tools write instead of a `.meta.json`, which Rojo then no longer applies. */
	get metaReplacements(): MetaReplacement[] {
		return this.tools.flatMap(
			({ metaReplacement }) => metaReplacement ?? []
		);
	}

	relativeToProject(absolutePath: string): string {
		return toPosix(path.relative(this.projectDir, absolutePath));
	}

	/** The absolute path the tools write for `filePath` under `syncDir`, or `filePath` itself when nothing syncs elsewhere. */
	emittedPath(filePath: string): string {
		if (this.syncDir === undefined) return filePath;
		return this.tools.reduce(
			(emitted, tool) => tool.emittedPath?.(emitted) ?? emitted,
			path.join(this.syncDir, path.relative(this.commonRoot, filePath))
		);
	}

	/** Whether a tool reads `source` without writing anything for it. */
	isReadOnly(source: string): boolean {
		return this.tools.some((tool) => tool.readsOnly?.(source));
	}

	/** The `$path` Rojo mounts for `filePath`. Optional, since a compiler may not have written it yet. */
	syncPath(filePath: string): OptionalRojoPath {
		return { optional: this.relativeToProject(this.emittedPath(filePath)) };
	}
}

const LISTED_PATHS = 3;

/** Checks what the sync dir holds against what the build expects there, which only changes when the compiler runs. */
export class SyncDirCheck {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Warns when the sync dir lacks what the tools should have written for the root dirs and their meta files. */
	async check(placement: Placement): Promise<Diagnostic[]> {
		const { syncDir } = placement.layout;
		if (syncDir === undefined) return [];
		return [
			...(await this.nothingEmitted(placement, syncDir)),
			...(await this.metaNotSynced(placement, syncDir)),
		];
	}

	/** Warns once per root dir whose top-level entries have no emitted counterpart under `syncDir`. */
	private async nothingEmitted(
		{ config, layout }: Placement,
		syncDir: string
	): Promise<Diagnostic[]> {
		const shown = (target: string) =>
			layout.relativeToProject(target) || ".";
		const warnings: Diagnostic[] = [];

		for (const rootDir of config.rootDirs) {
			const emitted = await this.topLevelEmitted(rootDir, layout);
			if (emitted.length === 0 || (await this.anyExists(emitted)))
				continue;

			const expected = path.join(
				syncDir,
				path.relative(layout.commonRoot, rootDir)
			);
			const found = await this.findShifted(syncDir, emitted[0]);
			const nearest = found
				? `Found "${shown(found)}" — is the compiler's output rooted differently?`
				: `The nearest path that exists is "${shown(await this.nearestExisting(expected))}" — has the compiler run?`;
			warnings.push(
				warningDiagnostic(
					"output.nothingEmitted",
					{ resource: rootDir },
					`nothing emitted for root dir "${shown(rootDir)}" exists under "${shown(expected)}". ${nearest}`
				)
			);
		}
		return warnings;
	}

	/** Warns once for claimed meta with no copy under `syncDir`, skipping root dirs `nothingEmitted` reports. */
	private async metaNotSynced(
		placement: Placement,
		syncDir: string
	): Promise<Diagnostic[]> {
		const { config, layout, roots } = placement;
		const unclaimed = new Set(
			placement.unclaimedMeta().map(({ path }) => path)
		);
		const replacements = layout.metaReplacements;

		const missing: string[] = [];
		let converted = 0;
		let conversion: MetaReplacement | undefined;

		for (const root of roots) {
			if (!(await this.hasSyncedOutput(root.rootDir, layout))) continue;
			for (const metaFile of root.metaFiles) {
				const source = path.join(root.rootDir, metaFile);
				if (unclaimed.has(toPosix(source))) continue;
				const emitted = layout.emittedPath(source);
				if (await this.fileSystemService.exists(emitted)) continue;
				missing.push(toPosix(source));
				const stem = emitted.slice(0, -RojoFile.META_SUFFIX.length);
				for (const replacement of replacements)
					if (
						await this.fileSystemService.exists(
							`${stem}${replacement.suffix}`
						)
					) {
						conversion ??= replacement;
						if (replacement === conversion) converted++;
						break;
					}
			}
		}
		if (missing.length === 0) return [];

		const them = missing.length === 1 ? "it" : "them";
		const cause = conversion
			? `The processor turned ${converted === missing.length ? them : `${converted} of them`} into ${conversion.suffix}, which Rojo syncs as a ModuleScript instead of applying. ${conversion.note}`
			: "Have the compiler copy .meta.json files into its output.";
		return [
			warningDiagnostic(
				"output.metaNotSynced",
				{ resource: config.outFile },
				`${missing.length} meta ${missing.length === 1 ? "file has" : "files have"} no copy under "${layout.relativeToProject(syncDir) || "."}" (${listLimited(missing, LISTED_PATHS)}), so Rojo doesn't apply ${them}. ${cause}`
			),
		];
	}

	/** Skips dot-files, which are mostly markers a compiler never emits. */
	private async topLevelEmitted(
		rootDir: string,
		layout: SyncLayout
	): Promise<string[]> {
		if (!(await this.fileSystemService.isDirectory(rootDir))) return [];
		return (await this.fileSystemService.readDirectory(rootDir))
			.filter(([name]) => !name.startsWith("."))
			.map(([name]) => layout.emittedPath(path.join(rootDir, name)));
	}

	private async anyExists(paths: readonly string[]): Promise<boolean> {
		for (const target of paths)
			if (await this.fileSystemService.exists(target)) return true;
		return false;
	}

	/** Whether any top-level entry of `rootDir` has its emitted counterpart under `syncDir`. */
	private async hasSyncedOutput(
		rootDir: string,
		layout: SyncLayout
	): Promise<boolean> {
		return this.anyExists(await this.topLevelEmitted(rootDir, layout));
	}

	/** Looks for `emitted` one level up or down from where it was expected, the way a shifted common root moves it. */
	private async findShifted(
		syncDir: string,
		emitted: string
	): Promise<string | undefined> {
		const segments = path.relative(syncDir, emitted).split(path.sep);
		const candidates = segments
			.slice(1)
			.map((_, index) =>
				path.join(syncDir, ...segments.slice(index + 1))
			);

		if (await this.fileSystemService.isDirectory(syncDir)) {
			for (const [
				name,
				type,
			] of await this.fileSystemService.readDirectory(syncDir))
				if (isDirectoryType(type))
					candidates.push(path.join(syncDir, name, ...segments));
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
