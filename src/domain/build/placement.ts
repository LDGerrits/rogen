import { groupBy } from "../../base/collection.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { SyncTool } from "../toolchain/toolchain.js";
import { BuildSummary, LeftOut } from "./build-service.js";
import { NameReader, NameReadings, RoutedFile, Router } from "./routing.js";
import { RootScanner, ScannedRoot, UnclaimedMeta } from "./root-scanner.js";
import { SyncLayout } from "./sync-layout.js";
import { BuildTemplate } from "./template.js";

/** Why each path is left out of the tree, by absolute POSIX path. */
export class LeftOutPaths implements Iterable<[string, LeftOut]> {
	private readonly reasons = new Map<string, LeftOut>();

	/** A path listed by a later source keeps the later reason. */
	constructor(...sources: Iterable<[string, LeftOut]>[]) {
		for (const source of sources)
			for (const [path, why] of source) this.reasons.set(path, why);
	}

	get size(): number {
		return this.reasons.size;
	}

	get(source: string): LeftOut | undefined {
		return this.reasons.get(source);
	}

	has(source: string): boolean {
		return this.reasons.has(source);
	}

	keys(): IterableIterator<string> {
		return this.reasons.keys();
	}

	values(): IterableIterator<LeftOut> {
		return this.reasons.values();
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

/** Files from one root dir that claim one instance path; the tag stage kept the last. */
export interface InstanceClash {
	readonly instance: string;
	readonly claimants: readonly RoutedFile[];
}

/** Where every scanned file lands, or why it lands nowhere; `where` stops here. */
export class Placement {
	private unclaimed: UnclaimedMeta[] | undefined;

	constructor(
		readonly config: ResolvedConfig,
		readonly index: IndexReader,
		readonly layout: SyncLayout,
		readonly template: BuildTemplate,
		readonly roots: readonly ScannedRoot[],
		readonly readings: NameReadings,
		/** Every file a route governs, in scan order, before tags decide which are placed. */
		readonly routed: readonly RoutedFile[],
		/** Every instance path appears once; the last root dir wins across roots. */
		readonly files: readonly RoutedFile[],
		/** Every path the build leaves out of the tree. */
		readonly leftOut: LeftOutPaths,
		readonly clashes: readonly InstanceClash[]
	) {}

	/** Meta no file claims, across every root dir; computed once. */
	unclaimedMeta(): UnclaimedMeta[] {
		this.unclaimed ??= this.roots.flatMap((root) => root.unclaimedMeta());
		return this.unclaimed;
	}

	/** What the build did, counted for the summary. */
	summary(): BuildSummary {
		const carrying = (
			tag: string,
			tagSets: readonly (readonly { readonly tag: string }[])[]
		) =>
			tagSets.filter((tags) => tags.some((match) => match.tag === tag))
				.length;
		const placedTags = this.files.map((file) => file.tags);
		// Every routed file with an off tag was pruned, so off tags count those.
		const prunedTags = this.leftOut
			.withStatus("pruned")
			.map(([, why]) => why.tags);
		return {
			roots: this.roots.map((root) => ({
				rootDir: root.rootDir,
				files: root.entries.length,
				excluded: root.excludedCount,
				skippedLinks: root.skippedCount,
			})),
			routes: [...this.config.routes].map(([key, target]) => ({
				key,
				target: target.toString(),
				files: this.files.filter((file) => file.route === key).length,
			})),
			tags: Object.entries(this.config.tags).map(([tag, on]) => ({
				tag,
				on,
				files: carrying(tag, on ? placedTags : prunedTags),
			})),
			unrouted: this.leftOut.count("unrouted"),
			superseded: this.leftOut.count("replaced"),
			displaced: this.leftOut.count("displaced"),
		};
	}
}

interface Tagging {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** The files pruned by a dormant tag and those another file replaced. */
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/** Finds where every file of a config lands: scans the root dirs, routes each file, applies tags and lets the template win. */
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
		const roots = this.scan();
		const readings = new NameReadings(new NameReader(keys), keys, roots);
		const { routed, unrouted } = new Router(
			keys,
			this.config.routes,
			readings
		).route(roots);
		const tagging = this.applyTags(routed);
		if (tagging.isErr()) return tagging;
		const templating = this.yieldToTemplate(tagging.value.files);

		return ok(
			new Placement(
				this.config,
				this.index,
				this.layout,
				this.template,
				roots,
				readings,
				routed,
				templating.files,
				new LeftOutPaths(
					roots.flatMap((root) => [...root.leftOut]),
					unrouted.map((source): [string, LeftOut] => [
						source,
						{ status: "unrouted" },
					]),
					tagging.value.leftOut,
					templating.leftOut
				),
				tagging.value.clashes
			)
		);
	}

	/** Reads the root dirs from the index, in `rootDirs` order, which decides clashes between them. */
	private scan(): ScannedRoot[] {
		const scanner = new RootScanner(this.index, this.config.exclude);
		return this.config.rootDirs.map((rootDir) => scanner.scan(rootDir));
	}

	/** Prunes what dormant tags remove, then resolves files that share an instance path. */
	private applyTags(
		routed: readonly RoutedFile[]
	): Result<Tagging, Diagnostic[]> {
		const leftOut: [string, LeftOut][] = [];
		const kept: RoutedFile[] = [];
		for (const file of routed) {
			const dormant = file.tags.filter(
				({ tag }) => !this.config.tags[tag]
			);
			if (dormant.length === 0) kept.push(file);
			else
				leftOut.push([
					file.entry.source,
					{ status: "pruned", tags: dormant },
				]);
		}

		const errors: Diagnostic[] = [];
		const clashes: InstanceClash[] = [];
		const winners = new Map<string, RoutedFile>();
		for (const root of groupBy(
			kept,
			(file) => file.entry.rootDir
		).values()) {
			for (const [instance, claimants] of groupBy(root, (file) =>
				instanceKey(file.instancePath)
			)) {
				const tagged = claimants.filter((file) => file.tags.length > 0);
				const untagged = claimants.filter(
					(file) => file.tags.length === 0
				);
				if (tagged.length > 1)
					errors.push(
						errorDiagnostic(
							"tag.activeClash",
							{ resource: this.config.outFile },
							`${tagged.length} files with active tags all become "${instance}" (${tagged.map(({ entry }) => entry.source).join(", ")}). Only one can apply: turn a tag off or rename a file.`
						)
					);
				else if (claimants.length > 1)
					clashes.push({ instance, claimants });
				winners.set(
					instance,
					tagged[0] ?? untagged[untagged.length - 1]
				);
			}
		}
		if (errors.length > 0) return err(errors);

		for (const file of kept) {
			const winner = winners.get(instanceKey(file.instancePath));
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
