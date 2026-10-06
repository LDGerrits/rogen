import { groupBy } from "../../base/collections.js";
import { isInside, joinPosix, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import path from "path";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { FileType } from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { RojoFile } from "../rojo/rojo.js";
import { InstanceMap, instanceKey } from "../rojo/rojo-project.js";
import { BuildSummary, LeftOut, SyncTool } from "./build.js";
import { BuildTemplate } from "./build-template.js";
import { NameReader, NameReadings } from "./name-reader.js";
import { RootScanner, ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { InitToCopy, InitWithoutFolder, RoutedFile, Router } from "./router.js";
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

/** Plain files from one root dir that claim one instance path; the last one wins and the others are replaced. */
export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
}

/** A routed file the template displaced: the node the template defines, and the file or folder that names it. */
export interface DisplacedFile {
	readonly file: RoutedFile;
	readonly node: readonly string[];
	readonly source: string;
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export class Placement {
	/** One per file a route governs, in scan order, before variants decide which are placed; at its own node, or at its first copy when a route placed it nowhere itself. */
	readonly routed: readonly RoutedFile[];
	/** One per placed file, at its own node, or at its first copy when a route placed it nowhere itself. */
	readonly files: readonly RoutedFile[];
	private readonly nodesBySource: ReadonlyMap<string, readonly RoutedFile[]>;
	private unclaimed: UnclaimedMeta[] | undefined;

	constructor(
		readonly config: ResolvedConfig,
		readonly layout: SyncLayout,
		readonly template: BuildTemplate,
		readonly roots: readonly ScannedRoot[],
		readonly readings: NameReadings,
		/** Every node a route sends a file to, in scan order, then the copies of init scripts. */
		routedNodes: readonly RoutedFile[],
		/** Every node a placed file is: one per file, and one more per other node a copied init script is. Every instance path appears once; the last root dir wins across roots. */
		readonly nodes: readonly RoutedFile[],
		/** Every path the build leaves out of the tree. */
		readonly leftOut: LeftOutPaths,
		readonly clashes: readonly InstanceClash[],
		/** The routed files the template displaced, in scan order. */
		readonly displaced: readonly DisplacedFile[]
	) {
		this.nodesBySource = groupBy(nodes, ({ entry }) => entry.source);
		this.routed = Placement.onePerFile(
			groupBy(routedNodes, ({ entry }) => entry.source)
		);
		this.files = Placement.onePerFile(this.nodesBySource);
	}

	private static onePerFile(
		bySource: ReadonlyMap<string, readonly RoutedFile[]>
	): RoutedFile[] {
		return [...bySource.values()].map(
			(nodes) =>
				nodes.find(({ routeMatch }) => routeMatch !== "copy") ??
				nodes[0]
		);
	}

	/** The other nodes a copied init script is. */
	otherNodesOf(file: RoutedFile): readonly RoutedFile[] {
		return (this.nodesBySource.get(file.entry.source) ?? []).filter(
			(node) => node !== file
		);
	}

	/** The directory Rojo reads an init script through, if it does, since it never reads a file with its init name alone. */
	initDirOf(file: RoutedFile): string | undefined {
		return file.init &&
			new RojoFile(
				path.basename(this.layout.emittedPath(file.entry.source))
			).isInit
			? file.init.sitsIn
			: undefined;
	}

	/** What the index holds in `dir`, which lies in one of the root dirs. */
	listing(dir: string): ReadonlyMap<string, FileType> {
		const root = this.roots.find((candidate) =>
			isInside(dir, toPosix(candidate.rootDir))
		);
		return root?.listing(path.normalize(dir)) ?? new Map();
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
			replaced: this.leftOut.count("replaced"),
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

/** Finds where every file of a config lands: scans the root dirs, routes each file, then decides across files: copies init scripts, applies variants and lets the template win. */
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
		const { mounts } = this.template;
		const rootDirMounts = mounts.rootDirErrors(this.config.rootDirs);
		if (rootDirMounts.length > 0) return err(rootDirMounts);
		const roots = this.scan();
		const readings = new NameReadings(new NameReader(keys), keys, roots);
		const { routed, toCopy, unrouted, withoutFolder } = new Router(
			this.config,
			readings,
			this.layout.initNames
		).route(roots);
		const withoutFolderErrors = this.withoutFolderErrors(withoutFolder);
		if (withoutFolderErrors.length > 0) return err(withoutFolderErrors);
		const routedNodes = this.withCopies(routed, toCopy);
		const applied = this.applyVariants(routedNodes);
		if (applied.isErr()) return applied;
		const nodes = this.withoutLoneInits(applied.value.files);
		const templating = this.yieldToTemplate(nodes);
		const placed = new Set(nodes.map(({ entry }) => entry.source));
		const leftOut = new LeftOutPaths(
			roots.flatMap((root) => [...root.leftOut]),
			unrouted
				.filter((source) => !placed.has(source))
				.map((source): [string, LeftOut] => [
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
				routedNodes,
				templating.files,
				leftOut,
				applied.value.clashes,
				templating.displaced
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

	/** An init script that can be placed but has no folder of its own to be leaves Rojo nothing to read it as. */
	private withoutFolderErrors(
		withoutFolder: readonly InitWithoutFolder[]
	): Diagnostic[] {
		return withoutFolder
			.filter(
				({ variants }) =>
					this.config.dormantVariants(variants).length === 0
			)
			.map(({ source, folder }) =>
				errorDiagnostic(
					"tree.initWithoutFolder",
					{ resource: source },
					`an init script becomes the folder it sits in, but it sits in ${folder}, which never becomes an instance. Move it into a folder of its own, or rename it.`
				)
			);
	}

	/** Each root dir's routed files, then the copies of its init scripts. */
	private withCopies(
		routed: readonly RoutedFile[],
		toCopy: readonly InitToCopy[]
	): RoutedFile[] {
		const toCopyByRoot = groupBy(toCopy, ({ entry }) => entry.rootDir);
		return [...groupBy(routed, ({ entry }) => entry.rootDir)].flatMap(
			([rootDir, fromRoot]) => [
				...fromRoot,
				...this.copies(toCopyByRoot.get(rootDir) ?? [], fromRoot),
			]
		);
	}

	/** An init ModuleScript no route sends anywhere is every node its folder becomes, so each of the others gets a copy of it. */
	private copies(
		toCopy: readonly InitToCopy[],
		routed: readonly RoutedFile[]
	): RoutedFile[] {
		// An init script that can be placed is its own folder's node, so a copy doesn't take it.
		const inits = routed.filter(
			({ init, variants }) =>
				init && this.config.dormantVariants(variants).length === 0
		);
		return toCopy.flatMap(
			({ entry, variants, buriedScriptSuffix, init, placed }) => {
				const nodes = new InstanceMap<RoutedFile>();
				for (const own of inits) nodes.set(own.instancePath, own);
				if (placed) nodes.set(placed.instancePath, placed);
				const copies: RoutedFile[] = [];
				for (const file of routed) {
					const at = file.folderNodes.findIndex(
						({ dir }) =>
							joinPosix(file.entry.rootDir, dir) === init.becomes
					);
					if (at < 0) continue;
					const { instancePath } = file.folderNodes[at];
					if (nodes.get(instancePath)) continue;
					const copy: RoutedFile = {
						entry,
						route: file.route,
						routeMatch: "copy",
						instancePath,
						folderNodes: file.folderNodes.slice(0, at + 1),
						ignoredRoutes: [],
						ignoredAts: [],
						variants,
						buriedScriptSuffix,
						init,
					};
					nodes.set(instancePath, copy);
					copies.push(copy);
				}
				return copies;
			}
		);
	}

	/** An init script parents what its folder holds, so it goes where nothing placed is left at its node; the fallback's own placement goes too once a copy that the template keeps carries it. Repeats, since a dropped init script empties the folders above it. */
	private withoutLoneInits(
		files: readonly RoutedFile[]
	): readonly RoutedFile[] {
		let kept = files;
		for (;;) {
			const named = new InstanceMap<true>();
			for (const { folderNodes, routeMatch, init } of kept)
				if (routeMatch !== "copy")
					for (const { instancePath } of init
						? folderNodes.slice(0, -1)
						: folderNodes)
						named.set(instancePath, true);
			const copies = kept.filter(
				({ routeMatch, instancePath }) =>
					routeMatch === "copy" && named.get(instancePath)
			);
			const carried = new Set(
				copies
					.filter((copy) => !this.template.displacing(copy))
					.map(({ entry }) => entry.source)
			);
			const next = kept.filter(
				({ routeMatch, init, entry, instancePath }) =>
					routeMatch === "copy"
						? named.get(instancePath)
						: !init ||
							!carried.has(entry.source) ||
							named.get(instancePath)
			);
			if (next.length === kept.length) return kept;
			kept = next;
		}
	}

	/** Prunes what dormant variants remove, then resolves files that share an instance path. */
	private applyVariants(
		routed: readonly RoutedFile[]
	): Result<VariantOutcome, Diagnostic[]> {
		const leftOut: [string, LeftOut][] = [];
		const kept: RoutedFile[] = [];
		for (const file of routed) {
			const dormant = this.config.dormantVariants(file.variants);
			if (dormant.length === 0) kept.push(file);
			else
				leftOut.push([
					file.entry.source,
					{ status: "pruned", variants: dormant },
				]);
		}

		const problems = new DiagnosticCollector();
		// A copied init script meets the same files at every node it is copied to, so each is reported once.
		const reported = new Set<string>();
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
						if (reported.has(entry.source)) continue;
						reported.add(entry.source);
						const others = variantFiles
							.filter((other) => other.entry !== entry)
							.map((other) => other.entry.source);
						problems.error(
							"variant.activeClash",
							{ resource: entry.source },
							`becomes "${instance}" with an active variant, and so ${others.length === 1 ? "does" : "do"} ${others.join(", ")}. Only one can apply: turn a variant off or rename a file.`
						);
					}
				}
				const winner = variantFiles[0] ?? plain[plain.length - 1];
				// A variant file replacing a plain one is what variants are for, so only plain files clash.
				if (variantFiles.length === 0 && plain.length > 1)
					clashes.push({
						instance,
						winner,
						losers: plain.slice(0, -1),
					});
				winners.set(claimants[0].instancePath, winner);
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
		readonly displaced: readonly DisplacedFile[];
	} {
		const files: RoutedFile[] = [];
		const leftOut: [string, LeftOut][] = [];
		const displaced: DisplacedFile[] = [];
		for (const file of placed) {
			const displacing = this.template.displacing(file);
			if (!displacing) {
				files.push(file);
				continue;
			}
			leftOut.push([
				file.entry.source,
				{ status: "displaced", node: displacing.node },
			]);
			displaced.push({ file, ...displacing });
		}
		return { files, leftOut, displaced };
	}
}
