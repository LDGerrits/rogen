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
import { ResolvedConfig } from "../config/config.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { LeftOut, SyncTool } from "./build.js";
import { BuildTemplate } from "./build-template.js";
import { NameReader } from "./name-reader.js";
import { InitScripts } from "./init-scripts.js";
import { NameReadings } from "./name-readings.js";
import { RootScanner, ScannedRoot } from "./root-scanner.js";
import {
	HoistedInit,
	InitWithoutFolder,
	LandsElsewhere,
	MarkerClash,
	RoutedFile,
	Router,
} from "./router.js";
import { SyncLayout } from "./sync-layout.js";
import { VariantResolution } from "./variant-resolution.js";
import { DisplacedFile, LeftOutPaths, Placement } from "./placement.js";

/** Finds where every file of a config lands: scans the root dirs, routes each file, then decides across files: copies init scripts, applies variants and lets the template win. */
export class Placer {
	private readonly layout: SyncLayout;
	private readonly template: BuildTemplate;
	private readonly initScripts: InitScripts;
	private readonly variants: VariantResolution;

	constructor(
		private readonly index: IndexReader,
		private readonly config: ResolvedConfig,
		tools: readonly SyncTool[]
	) {
		this.layout = new SyncLayout(config, tools);
		this.template = new BuildTemplate(config, this.layout);
		this.initScripts = new InitScripts(config, this.template);
		this.variants = new VariantResolution(config);
	}

	place(): Result<Placement, Diagnostic[]> {
		const { keys } = this.config;
		const { mounts } = this.template;
		const rootDirMounts = mounts.rootDirErrors(this.config.rootDirs);
		if (rootDirMounts.length > 0) return err(rootDirMounts);
		const roots = this.scan();
		const readings = new NameReadings(new NameReader(keys), keys, roots);
		const {
			routed,
			toCopy,
			unrouted,
			withoutFolder,
			hoistedInits,
			markerClashes,
			landsElsewhere,
		} = new Router(this.config, readings, this.layout.initNames).route(
			roots
		);
		const routeErrors = [
			...this.markerClashErrors(markerClashes),
			...this.ignoredAtErrors(
				routed.filter((file) => !this.template.displacing(file)),
				markerClashes
			),
			...this.withoutFolderErrors(withoutFolder),
			...this.hoistedInitErrors(hoistedInits),
			...this.landsElsewhereErrors(landsElsewhere, markerClashes),
		];
		const routedNodes = this.initScripts.withCopies(routed, toCopy);
		const applied = this.variants.apply(routedNodes);
		if (applied.isErr()) return err([...routeErrors, ...applied.error]);
		if (routeErrors.length > 0) return err(routeErrors);
		const nodes = this.initScripts.withoutLoneInits(applied.value.nodes);
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
			new Placement({
				config: this.config,
				layout: this.layout,
				template: this.template,
				roots,
				readings,
				routedNodes,
				nodes: templating.nodes,
				leftOut,
				clashes: applied.value.clashes,
				displaced: templating.displaced,
			})
		);
	}

	/** Reads the root dirs from the index, in `rootDirs` order, which decides clashes between them. */
	private scan(): ScannedRoot[] {
		const scanner = new RootScanner(
			this.index,
			this.config.exclude,
			this.template.mounts,
			this.config.outFile
		);
		return this.config.rootDirs.map((rootDir) => scanner.scan(rootDir));
	}

	/** Two routes at one level of a folder leave nothing to decide between them; init scripts of variants never on together don't either, since a variant never moves a file. */
	private markerClashErrors(
		markerClashes: readonly MarkerClash[]
	): Diagnostic[] {
		return markerClashes.map(({ dir, names, besideFolders }) => {
			const quoted = joinedWithAnd(names.map((name) => `"${name}"`));
			const folders = besideFolders?.length
				? `: ${joinedWithAnd(besideFolders.map((folder) => `${folder}/`))}`
				: "";
			return errorDiagnostic(
				"route.markerClash",
				{ resource: dir },
				besideFolders
					? `${quoted} route this folder to different places, but a variant never changes where a file lands. Move the files only a variant sends elsewhere into a folder beside this one${folders}.`
					: `${quoted} route this folder to different places, and nothing decides between them. Keep one.`
			);
		});
	}

	/** An `@` an outer route outranks does nothing, so the name lies about where the file is; once per file or folder that spells it, whichever variants are on, unless the template displaces the file. A marker in a clash is that error's. */
	private ignoredAtErrors(
		nodes: readonly RoutedFile[],
		markerClashes: readonly MarkerClash[]
	): Diagnostic[] {
		const clashing = new Set(
			markerClashes.flatMap(({ dir, names }) =>
				names.map((name) => joinPosix(dir, name))
			)
		);
		const ignored = new Map<
			string,
			{ keys: Set<string>; route: string; kind: string }
		>();
		for (const { entry, route, ignoredAts } of nodes)
			for (const { key, dir, marker } of ignoredAts) {
				const resource =
					dir === undefined
						? entry.source
						: joinPosix(entry.rootDir, dir, marker ?? "");
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

	/** An init script that can be placed but has no folder of its own to be leaves Rojo nothing to read it as. */
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

	/** The script is its folder, so a `^` on it hoists nothing the folder couldn't. */
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

	/** A variant that lands apart from the plain file beside it replaces nothing, so both would ship. A clash in a folder above it is that error's. */
	private landsElsewhereErrors(
		landsElsewhere: readonly LandsElsewhere[],
		markerClashes: readonly MarkerClash[]
	): Diagnostic[] {
		return landsElsewhere
			.filter(({ file }) => {
				const dir = path.posix.dirname(file.entry.source);
				return !markerClashes.some(
					(clash) =>
						dir === clash.dir || dir.startsWith(`${clash.dir}/`)
				);
			})
			.map(({ file, plain }) =>
				errorDiagnostic(
					"variant.landsElsewhere",
					{ resource: file.entry.source },
					`lands at "${instanceKey(file.instancePath)}", but ${plain.entry.source}, which it is a variant of, lands at "${instanceKey(plain.instancePath)}", so both would ship. Route and hoist them the same way.`
				)
			);
	}

	/** Leaves out the files whose node the template already defines; the template wins. */
	private yieldToTemplate(placed: readonly RoutedFile[]): {
		readonly nodes: readonly RoutedFile[];
		readonly leftOut: [string, LeftOut][];
		readonly displaced: readonly DisplacedFile[];
	} {
		const nodes: RoutedFile[] = [];
		const leftOut: [string, LeftOut][] = [];
		const displaced: DisplacedFile[] = [];
		for (const file of placed) {
			const displacing = this.template.displacing(file);
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
