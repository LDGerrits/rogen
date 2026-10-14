import { compareStrings } from "../../base/collections.js";
import { joinPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import path from "path";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { SyncTool } from "../toolchain/toolchain.js";
import { LeftOut } from "./build.js";
import { BuildTree } from "./build-tree.js";
import { InitScripts } from "./init-scripts.js";
import { NameReadings } from "./name-readings.js";
import { RootScanner, ScannedRoot } from "./root-scanner.js";
import {
	HoistedInit,
	InitWithoutFolder,
	RoutedFile,
	Router,
} from "./router.js";
import { RootClaims } from "./dir-claims.js";
import { MarkerClashes } from "./marker-clashes.js";
import { SyncLayout } from "./sync-layout.js";
import { InstanceResolver } from "./instance-resolver.js";
import { DisplacedFile, LeftOutPaths, Placement } from "./placement.js";

/** Finds where every file of a config lands: scans the source paths, routes each file, then resolves clashes across files. */
export class Placer {
	private readonly layout: SyncLayout;
	private readonly tree: BuildTree;
	private readonly initScripts: InitScripts;

	constructor(
		private readonly index: IndexReader,
		private readonly config: ResolvedConfig,
		tools: readonly SyncTool[]
	) {
		this.layout = new SyncLayout(config, tools);
		this.tree = new BuildTree(config, this.layout);
		this.initScripts = new InitScripts(this.tree);
	}

	place(): Result<Placement, Diagnostic[]> {
		const { keys } = this.config;
		const { mounts } = this.tree;
		const sourcePathMounts = mounts.sourcePathErrors(
			this.config.sourcePaths
		);
		if (sourcePathMounts.length > 0) return err(sourcePathMounts);
		const roots = this.scan();
		const readings = new NameReadings(
			keys,
			this.layout.initNames,
			roots,
			(source) => this.config.fileAt(source)
		);
		const claims = new RootClaims(roots, readings);
		const { routed, toCopy, unrouted, withoutFolder, hoistedInits } =
			new Router(this.config, readings).route(roots, claims);
		const markerClashes = new MarkerClashes(claims);
		const routeErrors = [
			...markerClashes.diagnostics(),
			...this.ignoredAtErrors(
				routed.filter((file) => !this.tree.displacing(file)),
				markerClashes
			),
			...this.withoutFolderErrors(withoutFolder),
			...this.hoistedInitErrors(hoistedInits),
		];
		if (routeErrors.length > 0) return err(routeErrors);
		const routedNodes = this.initScripts.withCopies(routed, toCopy);
		const resolved = new InstanceResolver().resolve(routedNodes);
		const nodes = this.initScripts.withoutLoneInits(resolved.nodes);
		const templating = this.yieldToTree(nodes);
		const placed = new Set(nodes.map(({ entry }) => entry.source));
		const leftOut = new LeftOutPaths(
			roots.flatMap((root) => [...root.leftOut]),
			unrouted
				.filter((source) => !placed.has(source))
				.map((source): [string, LeftOut] => [
					source,
					{ status: "unrouted" },
				]),
			resolved.leftOut,
			templating.leftOut
		);

		return ok(
			new Placement({
				config: this.config,
				layout: this.layout,
				tree: this.tree,
				roots,
				readings,
				routedNodes,
				nodes: templating.nodes,
				leftOut,
				clashes: resolved.clashes,
				displaced: templating.displaced,
			})
		);
	}

	private scan(): ScannedRoot[] {
		const scanner = new RootScanner(
			this.index,
			this.config.ignored,
			this.tree.mounts,
			this.config.projectFiles,
			(source) => this.config.fileAt(source)
		);
		return this.config.sourcePaths.map((sourcePath) =>
			scanner.scan(sourcePath)
		);
	}

	private ignoredAtErrors(
		nodes: readonly RoutedFile[],
		markerClashes: MarkerClashes
	): Diagnostic[] {
		const clashing = markerClashes.files;
		const ignored = new Map<
			string,
			{ keys: Set<string>; route: string; kind: string }
		>();
		for (const { entry, route, ignoredAts } of nodes)
			for (const { key, dir, marker } of ignoredAts) {
				const resource =
					dir === undefined
						? entry.source
						: joinPosix(entry.sourcePath, dir, marker ?? "");
				if (clashing.has(resource)) continue;
				const kind = dir === undefined ? "file" : "folder";
				const found = ignored.get(resource) ?? {
					keys: new Set<string>(),
					route,
					kind,
				};
				found.keys.add(key);
				ignored.set(resource, found);
			}
		return [...ignored]
			.sort(([a], [b]) => compareStrings(a, b))
			.map(([resource, { keys, route, kind }]) => {
				const many = keys.size > 1;
				const quoted = joinedWithAnd(
					[...keys].sort(compareStrings).map((key) => `"@${key}"`)
				);
				return errorDiagnostic(
					"route.ignoredAt",
					{ resource },
					`${quoted} ${many ? "do" : "does"} nothing here, because the "${route}" route already governs this ${kind}. Remove ${many ? "them" : "it"}, or move the ${kind} out of the "${route}" route's files.`
				);
			});
	}

	private withoutFolderErrors(
		withoutFolder: readonly InitWithoutFolder[]
	): Diagnostic[] {
		return withoutFolder.map(({ source, folder }) =>
			errorDiagnostic(
				"tree.initWithoutFolder",
				{ resource: source },
				`an init script becomes the folder it sits in, but it sits in ${folder}, which never becomes an instance. Move it into a folder of its own, or rename it.`
			)
		);
	}

	private hoistedInitErrors(
		hoistedInits: readonly HoistedInit[]
	): Diagnostic[] {
		return hoistedInits.map(({ source }) => {
			const folder = path.posix.dirname(source);
			return errorDiagnostic(
				"tree.hoistedInit",
				{ resource: folder },
				`${path.posix.basename(source)} starts with "^", but an init script is its folder, so the "^" can't hoist it alone. Put the "^" on the folder: ^${path.posix.basename(folder)}.`
			);
		});
	}

	private yieldToTree(placed: readonly RoutedFile[]): {
		readonly nodes: readonly RoutedFile[];
		readonly leftOut: [string, LeftOut][];
		readonly displaced: readonly DisplacedFile[];
	} {
		const nodes: RoutedFile[] = [];
		const leftOut: [string, LeftOut][] = [];
		const displaced: DisplacedFile[] = [];
		for (const file of placed) {
			const displacing = this.tree.displacing(file);
			if (!displacing) {
				nodes.push(file);
				continue;
			}
			leftOut.push([
				file.entry.source,
				{ status: "displaced", node: displacing.node },
			]);
			displaced.push({ file, ...displacing });
		}
		return { nodes, leftOut, displaced };
	}
}
