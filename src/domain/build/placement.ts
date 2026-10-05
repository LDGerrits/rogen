import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import path from "path";
import { contains, isInside } from "../../base/path.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { InstanceMap, instanceKey } from "../rojo/rojo-project.js";
import { BuildSummary, LeftOut, SyncTool } from "./build.js";
import { BuildTemplate } from "./build-template.js";
import { NameReader, NameReadings } from "./name-reader.js";
import { RootScanner, ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { RoutedFile, Router } from "./router.js";
import { SyncLayout } from "./sync-layout.js";

/** Why each path is left out of the tree, by absolute POSIX path. */
export class LeftOutPaths implements Iterable<[string, LeftOut]> {
	private readonly reasons = new Map<string, LeftOut>();

	/** A path listed by a later source keeps the later reason. */
	constructor(...sources: Iterable<[string, LeftOut]>[]) {
		for (const source of sources)
			for (const [path, why] of source) this.reasons.set(path, why);
	}

	get(source: string): LeftOut | undefined {
		return this.reasons.get(source);
	}

	[Symbol.iterator](): IterableIterator<[string, LeftOut]> {
		return this.reasons[Symbol.iterator]();
	}

	/** The paths left out for `status`, with why. */
	withStatus<S extends LeftOut["status"]>(
		status: S
	): [string, Extract<LeftOut, { status: S }>][] {
		return [...this.reasons].filter(
			(entry): entry is [string, Extract<LeftOut, { status: S }>] =>
				entry[1].status === status
		);
	}

	count(status: LeftOut["status"]): number {
		return this.withStatus(status).length;
	}
}

/** Files from one root dir that claim one instance path; within the root dir, the last one wins. */
export interface InstanceClash {
	readonly instance: string;
	readonly claimants: readonly RoutedFile[];
}

/** A routed file the template displaced, with the node that displaced it. */
export interface DisplacedFile {
	readonly file: RoutedFile;
	readonly node: readonly string[];
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export class Placement {
	private unclaimed: UnclaimedMeta[] | undefined;

	constructor(
		readonly config: ResolvedConfig,
		readonly layout: SyncLayout,
		readonly template: BuildTemplate,
		readonly roots: readonly ScannedRoot[],
		readonly readings: NameReadings,
		/** Every file a route governs, in scan order, before variants decide which are placed. */
		readonly routed: readonly RoutedFile[],
		/** Every instance path appears once; the last root dir wins across roots. */
		readonly files: readonly RoutedFile[],
		/** Every path the build leaves out of the tree. */
		readonly leftOut: LeftOutPaths,
		readonly clashes: readonly InstanceClash[]
	) {}

	/** The routed files the template displaced, in scan order. */
	get displaced(): DisplacedFile[] {
		return this.routed.flatMap((file) => {
			const why = this.leftOut.get(file.entry.source);
			return why?.status === "displaced"
				? [{ file, node: why.node }]
				: [];
		});
	}

	/** Meta no file claims, across every root dir; computed once. */
	unclaimedMeta(): UnclaimedMeta[] {
		this.unclaimed ??= this.roots.flatMap((root) => root.unclaimedMeta());
		return this.unclaimed;
	}

	/** What the build did, counted for the summary. */
	summary(): BuildSummary {
		const carrying = (
			variant: string,
			variantSets: readonly (readonly { readonly variant: string }[])[]
		) =>
			variantSets.filter((variants) =>
				variants.some((match) => match.variant === variant)
			).length;
		const placedVariants = this.files.map((file) => file.variants);
		// Every routed file with an off variant was pruned, so off variants count those.
		const prunedVariants = this.leftOut
			.withStatus("pruned")
			.map(([, why]) => why.variants);
		return {
			roots: this.roots.map((root) => ({
				rootDir: root.rootDir,
				files: root.entries.length,
				excluded: root.excludedCount,
				mounted: root.mountedCount,
				skippedLinks: root.skippedCount,
			})),
			routes: [...this.config.routes].map(([key, target]) => ({
				key,
				target: target.toString(),
				files: this.files.filter((file) => file.route === key).length,
			})),
			variants: Object.entries(this.config.variants).map(
				([variant, on]) => ({
					variant,
					on,
					files: carrying(
						variant,
						on ? placedVariants : prunedVariants
					),
				})
			),
			unrouted: this.leftOut.count("unrouted"),
			superseded: this.leftOut.count("replaced"),
			displaced: this.leftOut.count("displaced"),
		};
	}
}

interface VariantOutcome {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** The files pruned by a dormant variant and those another file replaced. */
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/** Finds where every file of a config lands: scans the root dirs, routes each file, applies variants and lets the template win. */
export class Placer {
	private readonly layout: SyncLayout;
	private readonly template: BuildTemplate;

	constructor(
		private readonly index: IndexReader,
		private readonly config: ResolvedConfig,
		tools: readonly SyncTool[]
	) {
		this.layout = new SyncLayout(config, tools);
		this.template = new BuildTemplate(config, this.layout);
	}

	place(): Result<Placement, Diagnostic[]> {
		const { keys } = this.config;
		const rootDirMounts = this.rootDirMountErrors();
		if (rootDirMounts.length > 0) return err(rootDirMounts);
		const roots = this.scan();
		const initFolderMounts = this.initFolderMountErrors(roots);
		if (initFolderMounts.length > 0) return err(initFolderMounts);
		const readings = new NameReadings(new NameReader(keys), keys, roots);
		const { routed, unrouted } = new Router(
			keys,
			this.config.routes,
			readings
		).route(roots);
		const applied = this.applyVariants(routed);
		if (applied.isErr()) return applied;
		const templating = this.yieldToTemplate(applied.value.files);
		const leftOut = new LeftOutPaths(
			roots.flatMap((root) => [...root.leftOut]),
			unrouted.map((source): [string, LeftOut] => [
				source,
				{ status: "unrouted" },
			]),
			applied.value.leftOut,
			templating.leftOut
		);

		return ok(
			new Placement(
				this.config,
				this.layout,
				this.template,
				roots,
				readings,
				routed,
				templating.files,
				leftOut,
				applied.value.clashes
			)
		);
	}

	/** Reads the root dirs from the index, in `rootDirs` order, which decides clashes between them. */
	private scan(): ScannedRoot[] {
		const scanner = new RootScanner(
			this.index,
			this.config.exclude,
			this.template.mounts
		);
		return this.config.rootDirs.map((rootDir) => scanner.scan(rootDir));
	}

	/** A template `$path` at a root dir or above one would hand the whole root dir to Rojo, leaving Rogen nothing to place there. */
	private rootDirMountErrors(): Diagnostic[] {
		const { template, rootDirs } = this.config;
		if (!template) return [];
		return this.template.mounts.flatMap(({ path: mounted, node }) => {
			const rootDir = rootDirs.find((dir) => contains(mounted, dir));
			return rootDir === undefined
				? []
				: [
						errorDiagnostic(
							"template.mountsRootDir",
							{ resource: template.file },
							`"${instanceKey(node)}" mounts ${mounted === rootDir ? `the root dir ${rootDir}` : `${mounted}, which holds the root dir ${rootDir}`}, so Rojo would read all of it and Rogen would place nothing there. Mount a folder inside the root dir, or remove the root dir from "rootDirs".`
						),
					];
		});
	}

	/** Rojo reads an init folder whole, so a template `$path` inside one would sync that path twice. */
	private initFolderMountErrors(roots: readonly ScannedRoot[]): Diagnostic[] {
		const { template } = this.config;
		if (!template) return [];
		return roots.flatMap((root) =>
			root.entries.flatMap((entry) => {
				if (entry.kind !== "init-folder") return [];
				const folder = path.join(entry.rootDir, entry.relativePath);
				return this.template.mounts
					.filter((mount) => isInside(mount.path, folder))
					.map(({ path: mounted, node }) =>
						errorDiagnostic(
							"template.mountsInsideInitFolder",
							{ resource: template.file },
							`"${instanceKey(node)}" mounts ${mounted}, inside the init folder ${folder}, which Rojo reads whole, so it would be synced twice. Mount the init folder itself, or move the mounted folder out of it.`
						)
					);
			})
		);
	}

	/** Prunes what dormant variants remove, then resolves files that share an instance path. */
	private applyVariants(
		routed: readonly RoutedFile[]
	): Result<VariantOutcome, Diagnostic[]> {
		const leftOut: [string, LeftOut][] = [];
		const kept: RoutedFile[] = [];
		for (const file of routed) {
			const dormant = file.variants.filter(
				({ variant }) => !this.config.variants[variant]
			);
			if (dormant.length === 0) kept.push(file);
			else
				leftOut.push([
					file.entry.source,
					{ status: "pruned", variants: dormant },
				]);
		}

		const problems = new DiagnosticCollector();
		const clashes: InstanceClash[] = [];
		const winners = new InstanceMap<RoutedFile>();
		for (const root of groupBy(
			kept,
			(file) => file.entry.rootDir
		).values()) {
			for (const [instance, claimants] of groupBy(root, (file) =>
				instanceKey(file.instancePath)
			)) {
				const variantFiles = claimants.filter(
					(file) => file.variants.length > 0
				);
				const plain = claimants.filter(
					(file) => file.variants.length === 0
				);
				if (variantFiles.length > 1) {
					for (const { entry } of variantFiles) {
						const others = variantFiles
							.filter((other) => other.entry !== entry)
							.map((other) => other.entry.source);
						problems.error(
							"variant.activeClash",
							{ resource: entry.source },
							`becomes "${instance}" with an active variant, and so ${others.length === 1 ? "does" : "do"} ${others.join(", ")}. Only one can apply: turn a variant off or rename a file.`
						);
					}
				} else if (claimants.length > 1) {
					clashes.push({ instance, claimants });
				}
				winners.set(
					claimants[0].instancePath,
					variantFiles[0] ?? plain[plain.length - 1]
				);
			}
		}
		if (problems.hasErrors) return err([...problems.diagnostics]);

		for (const file of kept) {
			const winner = winners.get(file.instancePath);
			if (winner && winner !== file)
				leftOut.push([
					file.entry.source,
					{ status: "replaced", by: winner.entry.source },
				]);
		}
		return ok({ files: [...new Set(winners.values())], leftOut, clashes });
	}

	/** Leaves out the files whose node the template already defines; the template wins. */
	private yieldToTemplate(placed: readonly RoutedFile[]): {
		readonly files: readonly RoutedFile[];
		readonly leftOut: [string, LeftOut][];
	} {
		const files: RoutedFile[] = [];
		const leftOut: [string, LeftOut][] = [];
		for (const file of placed) {
			const node = this.template.displacingNode(file);
			if (node)
				leftOut.push([
					file.entry.source,
					{ status: "displaced", node },
				]);
			else files.push(file);
		}
		return { files, leftOut };
	}
}
