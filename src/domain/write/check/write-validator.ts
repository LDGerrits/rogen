import path from "path";
import { compareStrings } from "../../../base/collections.js";
import { isObject } from "../../../base/objects.js";
import { isInside, joinPosix, toPosix } from "../../../base/path.js";
import {
	capitalized,
	joinedBriefly,
	joinedWithOr,
} from "../../../base/strings.js";
import {
	Diagnostic,
	DiagnosticFix,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys } from "../../config/declared-keys.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	InstanceMap,
	ScriptRun,
	isPlayerScriptContainer,
	isServerOnlyService,
	scriptFate,
	instanceKey,
} from "../../roblox/roblox.js";
import { RojoFile, SCRIPT_SUFFIXES, scriptRunOf } from "../../rojo/rojo.js";
import { NODE_FIELDS, RojoNode } from "../../rojo/rojo-project.js";
import { FolderMeta } from "../folder-meta.js";
import {
	MisspellingKind,
	MisspellingOf,
	NotedName,
} from "../misspelling-finder.js";
import { Placement } from "../placement.js";
import { MissingSourcePaths } from "./missing-source-paths.js";
import { RoutedFile } from "../router.js";
import { Assembly } from "../tree-assembler.js";

/** A script suffix written before an `@` suffix, as in `Start.server@client.luau`, where Rojo doesn't read it. */
const SCRIPT_SUFFIX_BEFORE_AT = new RegExp(
	`^(?<stem>.+)\\.(?<suffix>${SCRIPT_SUFFIXES.join("|")})@[^.@]+(?<extension>\\.[^.@]+)$`
);

const LISTED_FILES = 3;

function reservedKeys(
	node: RojoNode,
	at: readonly string[]
): (readonly string[])[] {
	return Object.entries(node).flatMap(([key, value]) => {
		if (!isObject(value) || NODE_FIELDS.has(key)) return [];
		const here = [...at, key];
		return [
			...(key.startsWith("$") ? [here] : []),
			...reservedKeys(value, here),
		];
	});
}

/** Reports on a finished placement without re-deciding what its phases decided. */
export class WriteValidator {
	private readonly placement: Placement;
	private readonly config: ResolvedConfig;

	constructor(private readonly assembly: Assembly) {
		this.placement = assembly.placement;
		this.config = assembly.placement.config;
	}

	validate(): Diagnostic[] {
		return [
			...this.missingSourcePath(),
			...this.sourcePathNamedAfterKey(),
			...this.unresolvedLink(),
			...this.noSyncedFiles(),
			...this.uncompiled(),
			...this.extensionCase(),
			...this.syncRuleSuffix(),
			...this.nestedProject(),
			...this.unclaimedMeta(),
			...this.dotRoute(),
			...this.patternCase(),
			...this.folderPattern(),
			...this.unrouted(),
			...this.serverCodeShipped(),
			...this.deadScript(),
			...this.scriptSuffixBeforeAt(),
			...this.scriptClassMismatch(),
			...this.reservedName(),
			...this.instanceClash(),
			...this.emptyName(),
			...this.portableName(),
			...this.runContextTarget(),
			...this.nodeClash(),
			...this.metaNotCopied(),
			...this.treeClass(),
			...this.metaAppliesToNothing(),
		];
	}

	private missingSourcePath(): Diagnostic[] {
		return new MissingSourcePaths(
			this.placement.roots,
			this.config.projectFile,
			this.config.usesDefaultSourcePath
		).warnings();
	}

	private sourcePathNamedAfterKey(): Diagnostic[] {
		const configDir = path.dirname(this.config.file);
		return this.config.sourcePaths.flatMap((sourcePath) => {
			const name = path.basename(sourcePath);
			const key = this.config.keys.resolve(name);
			if (key === undefined) return [];
			const parent = path.dirname(sourcePath);
			const fix = isInside(parent, configDir)
				? `use "${toPosix(path.relative(configDir, parent))}" as the source path instead, so "${name}" is read as a key`
				: `move it into a folder, such as src/${toPosix(path.relative(configDir, sourcePath))}, and use "sourcePaths": ["src"]`;
			return [
				warningDiagnostic(
					"scan.sourcePathNamedAfterKey",
					{ resource: sourcePath },
					`named after the "${key}" route: ${fix}`
				),
			];
		});
	}

	private unresolvedLink(): Diagnostic[] {
		return this.placement.leftOut
			.withStatus("skipped")
			.map(([link]) => link)
			.sort(compareStrings)
			.map((link) =>
				warningDiagnostic(
					"scan.unresolvedLink",
					{ resource: link },
					"this link points at nothing, or back at a directory that contains it, so it contributes nothing."
				)
			);
	}

	private noSyncedFiles(): Diagnostic[] {
		const { layout } = this.placement;
		return this.placement.roots.flatMap(
			({ sourcePath, entries, mountedCount, unsynced: scanned }) => {
				const unsynced = scanned.filter(
					(file) => !layout.isReadOnly(file)
				);
				if (
					entries.length > 0 ||
					mountedCount > 0 ||
					unsynced.length === 0
				)
					return [];
				return [
					warningDiagnostic(
						"scan.noSyncedFiles",
						{ resource: sourcePath },
						`this source path places nothing: ${this.noSyncedFilesAdvice(sourcePath, unsynced)}`,
						[],
						unsynced.map((resource) => ({
							resource,
							message: "read by no sync rule",
						}))
					),
				];
			}
		);
	}

	/** Each TypeScript file where no compiler writes the Luau Rojo would read, in a source path that places other files; one that places nothing gets `scan.noSyncedFiles`. */
	private uncompiled(): Diagnostic[] {
		if (this.placement.layout.compiledPath !== undefined) return [];
		return this.placement.roots
			.filter(({ entries }) => entries.length > 0)
			.flatMap(({ unsynced }) =>
				unsynced
					.filter((file) => /\.tsx?$/.test(file))
					.map((resource) =>
						warningDiagnostic(
							"scan.uncompiled",
							{ resource },
							'is TypeScript, which Rojo never reads itself, and the config has no "compiledPath", so it is left out. Set "compiledPath" to the folder roblox-ts writes, as "out", or remove the file.'
						)
					)
			);
	}

	private noSyncedFilesAdvice(
		sourcePath: string,
		unsynced: readonly string[]
	): string {
		const listed = joinedBriefly(
			unsynced.map((file) =>
				path.posix.relative(toPosix(sourcePath), file)
			),
			LISTED_FILES
		);
		const compiled = this.placement.layout.compiledPath !== undefined;
		const typeScript = unsynced.some((file) => /\.tsx?$/.test(file));
		const others = unsynced.some((file) => !/\.tsx?$/.test(file));
		const advice =
			!compiled && typeScript
				? `Rojo reads only the Luau a compiler writes for TypeScript: set "compiledPath" to the folder roblox-ts writes, as "out".${others ? ' For the other files, add a "syncRules" entry for their extension.' : ""}`
				: !compiled
					? 'Add a "syncRules" entry for their extension, and a "compiledPath" if a compiler turns them into Luau.'
					: 'Add a "syncRules" entry for their extension.';
		return `Rojo reads none of its files (${listed}). ${advice}`;
	}

	private syncRuleSuffix(): Diagnostic[] {
		return this.placement.roots
			.flatMap(({ entries }) => entries)
			.sort((a, b) => compareStrings(a.source, b.source))
			.flatMap(({ source, file }) => {
				const rule = file.suffixMissedBy;
				return rule
					? [
							warningDiagnostic(
								"scan.syncRuleSuffix",
								{ resource: source },
								`the sync rule "${rule.pattern}" cuts "${rule.suffix}" off a file name, but this name does not end with it, so Rojo names the instance after the whole file name. Make the suffix end every file the pattern matches.`
							),
						]
					: [];
			});
	}

	private nestedProject(): Diagnostic[] {
		return this.placement.files
			.filter(
				({ entry }) =>
					entry.file.isDefaultProject &&
					!entry.relativePath.includes("/")
			)
			.map(({ entry, instancePath }) =>
				warningDiagnostic(
					"scan.nestedProject",
					{ resource: entry.source },
					`a source path never becomes an instance, so this project becomes ${instanceKey(instancePath)} on its own. Move it into a folder.`
				)
			);
	}

	private extensionCase(): Diagnostic[] {
		return this.placement.leftOut
			.withStatus("extensionCase")
			.sort(([a], [b]) => compareStrings(a, b))
			.map(([file, { rename }]) =>
				warningDiagnostic(
					"scan.extensionCase",
					{ resource: file },
					`Rojo reads an extension only in lowercase, so it ignores this file. Rename it to ${rename}.`,
					[
						{
							rename: {
								from: file,
								to: path.posix.join(
									path.posix.dirname(file),
									rename
								),
							},
						},
					]
				)
			);
	}

	private unclaimedMeta(): Diagnostic[] {
		return this.placement
			.unclaimedMeta()
			.map(({ path: resource, hint }) =>
				warningDiagnostic(
					"meta.unclaimed",
					{ resource },
					`belongs to no file, so Rojo ignores it. ${hint ? `${capitalized(hint)}.` : "A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin."}`
				)
			);
	}

	private dotRoute(): Diagnostic[] {
		return this.misspelt(
			"route.dotRoute",
			"dotRoute",
			(resource, { renamedTo }) =>
				`write "${path.posix.basename(renamedTo ?? resource)}"`,
			(resource, { key, respelling }) => {
				if (!respelling.spelling.startsWith("@")) return undefined;
				const governing = this.governingRoute(resource, key);
				return governing === undefined
					? undefined
					: `the "${governing}" route governs it, so "@${key}" would do nothing; move it out of that route's files to route it`;
			}
		);
	}

	/** The route other than `key` that governs `resource` through a folder above it, read from the files below it that no route folder or `@` name of its own sits between. */
	private governingRoute(resource: string, key: string): string | undefined {
		return this.placement.files.find(({ entry, route }) => {
			if (route === key || !DeclaredKeys.isName(route)) return false;
			if (entry.source === resource) return true;
			if (!entry.source.startsWith(`${resource}/`)) return false;
			return entry.source
				.slice(resource.length + 1)
				.split("/")
				.slice(0, -1)
				.every(
					(folder) =>
						!folder.includes("@") &&
						this.config.keys.resolve(folder) === undefined
				);
		})?.route;
	}

	/** A file that falls to `*` though a pattern would take it but for letter case. */
	private patternCase(): Diagnostic[] {
		const { patterns } = this.config;
		return this.placement.files.flatMap(({ entry, routeMatch, init }) => {
			if (routeMatch !== "fallback" || init) return [];
			const key = patterns.matchIgnoringCase(
				...[
					path.posix.basename(entry.source),
					entry.file.instanceName,
				].map((name) => name.replace(/^\^/, ""))
			);
			return key === undefined
				? []
				: [
						warningDiagnostic(
							"route.patternCase",
							{ resource: entry.source },
							`matches the pattern "${key}" only ignoring letter case, so it goes to "*". A pattern matches letter case exactly; fix the pattern's case or the file's.`
						),
					];
		});
	}

	/** A folder of an init script that falls to `*` though a pattern matches its name, as no pattern routes a folder; with the rename to the name key of the pattern's place. */
	private folderPattern(): Diagnostic[] {
		const { patterns } = this.config;
		const folders = new Set(
			this.placement.files.flatMap(({ routeMatch, init }) =>
				routeMatch === "fallback" && init ? [init.becomes] : []
			)
		);
		return [...folders].flatMap((folder) => {
			const name = path.posix.basename(folder);
			const match = patterns.match(name);
			if (match?.kind !== "routed") return [];
			const key = patterns.nameKeyFor(match.key);
			const plain = /^[^^(]/.test(name);
			return [
				warningDiagnostic(
					"route.folderPattern",
					{ resource: folder },
					`matches the pattern "${match.key}", but a pattern never routes a folder or its init script, so it and its files go to "*". ${key === undefined ? "Route it with a folder or marker for that place." : `Name it ${name}@${key} to route it there.`}`,
					key !== undefined && plain
						? [{ rename: { from: folder, to: `${folder}@${key}` } }]
						: []
				),
			];
		});
	}

	private misspelt<K extends MisspellingKind>(
		code: string,
		kind: K,
		hint: (
			resource: string,
			misspelt: NotedName<MisspellingOf<K>>
		) => string,
		/** Why the fix the hint names would not work, which replaces the hint and the rename. */
		unusable: (
			resource: string,
			misspelt: NotedName<MisspellingOf<K>>
		) => string | undefined = () => undefined
	): Diagnostic[] {
		return [...this.placement.readings.misspelt(kind)].map(
			([resource, misspelt]) => {
				const why = unusable(resource, misspelt);
				const { renamedTo } = misspelt;
				return warningDiagnostic(
					code,
					{ resource },
					why ?? hint(resource, misspelt),
					why === undefined && renamedTo
						? [{ rename: { from: resource, to: renamedTo } }]
						: []
				);
			}
		);
	}

	private unrouted(): Diagnostic[] {
		const [first, ...rest] = this.config.keys.routeKeys;
		return this.placement.leftOut
			.withStatus("unrouted")
			.map(([resource]) =>
				warningDiagnostic(
					"route.unrouted",
					{ resource },
					`matched no route, so it is left out. Move it into a routing folder, as ${path.join(this.featureFolderOf(resource), first)}, end its name with a route's @ suffix (${joinedWithOr([first, ...rest].map((key) => `@${key}`))}), or declare a "*" route.`
				)
			);
	}

	/** The folder directly in a source path that holds `source`, or the source path for a file at its top. */
	private featureFolderOf(source: string): string {
		const sourcePath =
			this.config.sourcePaths.find((dir) => isInside(source, dir)) ??
			path.dirname(source);
		const [top, ...below] = path
			.relative(sourcePath, source)
			.split(path.sep);
		return below.length > 0 ? path.join(sourcePath, top) : sourcePath;
	}

	private shipped(): RoutedFile[] {
		const { routes } = this.config;
		return this.placement.files.filter((file) => {
			const outranksServerRoute = file.outrankedFolderRoutes.some(
				(key) => {
					const service = routes.get(key)?.service;
					return (
						service !== undefined && isServerOnlyService(service)
					);
				}
			);
			const isScript =
				this.placement.readingOf(file).scriptSuffix !== undefined;
			return (
				outranksServerRoute &&
				!isScript &&
				!isServerOnlyService(file.instancePath[0])
			);
		});
	}

	private serverCodeShipped(): Diagnostic[] {
		return [...this.shippedByFolder(), ...this.namedForServer()];
	}

	/** A file nothing routes whose own name is a server route key, as `Bank/Server.luau`, which reads as server code and lands where clients reach it. */
	private namedForServer(): Diagnostic[] {
		const { routes, keys } = this.config;
		return this.placement.files.flatMap((file) => {
			const { entry, routeMatch, init, instancePath } = file;
			// A Script's suffix routes it, and tree.deadScript says where it can't run.
			if (
				routeMatch !== "fallback" ||
				init ||
				this.placement.readingOf(file).scriptSuffix !== undefined
			)
				return [];
			const name = instancePath.at(-1)!;
			const key = keys.resolve(name) ?? keys.nearMiss(name);
			const service =
				key === undefined ? undefined : routes.get(key)?.service;
			return key === undefined ||
				service === undefined ||
				!isServerOnlyService(service) ||
				isServerOnlyService(instancePath[0])
				? []
				: [
						warningDiagnostic(
							"route.serverCodeShipped",
							{ resource: entry.source },
							`is named like the "${key}" route, but only a folder, a marker or an "@" routes a file, so it ships to clients as ${instanceKey(instancePath)}. If it's server code, move it into a "${key}" folder.`
						),
					];
		});
	}

	private shippedByFolder(): Diagnostic[] {
		return this.shipped().map((file) =>
			warningDiagnostic(
				"route.serverCodeShipped",
				{ resource: file.entry.source },
				`ships to clients as ${instanceKey(file.instancePath)}: move it out of the "${file.route}" route's files if it's server code, or keep it there with a "@${file.route}" marker file in its folder`
			)
		);
	}

	private scriptsThatNeverRun(): { file: RoutedFile; run: ScriptRun }[] {
		return this.placement.files.flatMap((file) => {
			const run = this.scriptRunOf(file);
			return run !== undefined &&
				scriptFate(run, file.instancePath) === "neverRuns"
				? [{ file, run }]
				: [];
		});
	}

	private deadScript(): Diagnostic[] {
		return this.scriptsThatNeverRun().map(({ file, run }) =>
			warningDiagnostic(
				"tree.deadScript",
				{ resource: file.entry.source },
				`${WriteValidator.describeRun(run)} never runs in ${file.instancePath[0]}${this.outrankedSuffix(file)}`
			)
		);
	}

	/** Why a script's `.server` or `.client` didn't route it: a route above it governs it. */
	private outrankedSuffix(file: RoutedFile): string {
		const suffix = this.placement.readingOf(file).scriptSuffix;
		const key =
			suffix === undefined
				? undefined
				: this.config.keys.resolveDotRoute(suffix);
		return key === undefined || key === file.route
			? ""
			: `: the "${file.route}" route governs this file, so ".${suffix}" routes nothing here`;
	}

	private scriptRunOf(file: RoutedFile): ScriptRun | undefined {
		return scriptRunOf(
			this.placement.readingOf(file).scriptSuffix,
			!this.placement.tree.disablesLegacyScripts,
			this.assembly.meta.runContextOf(file.entry.source)
		);
	}

	private static describeRun(run: ScriptRun): string {
		return run === "Script" || run === "LocalScript"
			? `a ${run}`
			: `a Script with RunContext ${run}`;
	}

	private scriptClassMismatch(): Diagnostic[] {
		return this.placement.files.flatMap(({ entry }) => {
			const { file, source } = entry;
			const message = file.isCompiled
				? WriteValidator.compiledClassMismatch(file)
				: WriteValidator.moduleRuleMismatch(file);
			return message
				? [
						warningDiagnostic(
							"route.scriptClassMismatch",
							{ resource: source },
							message
						),
					]
				: [];
		});
	}

	private static moduleRuleMismatch(file: RojoFile): string | undefined {
		const named = RojoFile.scriptSuffixOf(file.stem);
		const rule = file.ownRule;
		if (!named || rule?.use !== "moduleScript") return undefined;
		const extension = rule.suffix ?? path.extname(file.name);
		const advised = `{ "pattern": "*.${named}${extension}", "use": "${named}Script", "suffix": ".${named}${extension}" }`;
		return `the sync rule "${rule.pattern}" makes this file a ModuleScript, so it never runs. For a ${named} script, add ${advised} before that rule; for a module, remove ".${named}".`;
	}

	private static compiledClassMismatch(file: RojoFile): string | undefined {
		const emitted = file.renamed(`${file.stem}.luau`);
		if (
			emitted.ownRule &&
			(emitted.kind !== file.kind ||
				emitted.scriptSuffix !== file.scriptSuffix ||
				emitted.instanceName !== file.instanceName)
		)
			return `the sync rule "${emitted.ownRule.pattern}" also takes the compiled ${emitted.name}, so Rojo reads it by the rule, not by its name. Narrow the pattern to the source extension.`;
		const { ownRule: rule, scriptSuffix: given } = file.uncompiled;
		if (!rule || !given || given === RojoFile.scriptSuffixOf(file.stem))
			return undefined;
		const renamed = `${RojoFile.scriptNameOf(file.stem)}.${given}${path.extname(file.name)}`;
		return `the sync rule "${rule.pattern}" asks for a ${given} script, but Rojo reads the class from the compiled name ${emitted.name}. Rename it ${renamed}, or set the rule's "use" to "moduleScript".`;
	}

	private scriptSuffixBeforeAt(): Diagnostic[] {
		const scanned = new Set(
			this.placement.roots.flatMap(({ entries }) =>
				entries.map(({ source }) => source)
			)
		);
		return this.placement.files.flatMap((file) => {
			const read = file.entry.file;
			if (read.kind !== "script" || read.scriptSuffix !== undefined)
				return [];
			const found = SCRIPT_SUFFIX_BEFORE_AT.exec(
				path.posix.basename(file.entry.source)
			)?.groups;
			if (!found) return [];
			const { stem, suffix, extension } = found;
			const named = `${stem}.${suffix}${extension}`;
			if (read.renamed(named).scriptSuffix !== suffix) return [];
			const to = path.posix.join(
				path.posix.dirname(file.entry.source),
				named
			);
			const suffixRoutesHere =
				this.config.keys.resolveDotRoute(suffix) === file.route;
			const script = suffixRoutesHere
				? `rename it ${named}, which the "${file.route}" route takes`
				: `name it ${named} in a folder that routes it`;
			return [
				warningDiagnostic(
					"route.scriptSuffixBeforeAt",
					{ resource: file.entry.source },
					`Rojo reads ".${suffix}" only at the end of a name, so this is a ModuleScript named "${file.instancePath.at(-1)}". For a Script, ${script}; for a module, remove ".${suffix}".`,
					suffixRoutesHere && !scanned.has(to)
						? [{ rename: { from: file.entry.source, to } }]
						: []
				),
			];
		});
	}

	private reservedName(): Diagnostic[] {
		return reservedKeys(this.assembly.projectFile.tree, []).flatMap(
			(key) => {
				const file = this.fileNamedBy(key);
				if (!file) return [];
				const isTheNode =
					file.instancePath.length === key.length &&
					file.init === undefined;
				return [
					warningDiagnostic(
						"tree.reservedName",
						{ resource: file.entry.source },
						`Rojo reserves a leading $, so it warns about "${instanceKey(key)}" on every build. Rename ${isTheNode ? "the file" : "the folder"} without the $.`,
						isTheNode ? WriteValidator.withoutDollar(file) : []
					),
				];
			}
		);
	}

	private fileNamedBy(key: readonly string[]): RoutedFile | undefined {
		const under = this.placement.routed.filter(({ instancePath }) =>
			key.every((name, index) => instancePath[index] === name)
		);
		return (
			under.find(
				({ instancePath }) => instancePath.length === key.length
			) ?? under[0]
		);
	}

	private static withoutDollar({ entry }: RoutedFile): DiagnosticFix[] {
		const fileName = path.posix.basename(entry.source);
		if (!fileName.startsWith("$") || fileName.length === 1) return [];
		return [
			{
				rename: {
					from: entry.source,
					to: path.posix.join(
						path.posix.dirname(entry.source),
						fileName.slice(1)
					),
				},
			},
		];
	}

	private instanceClash(): Diagnostic[] {
		return [...this.replacedInstance(), ...this.adoptedChildren()];
	}

	private adoptedChildren(): Diagnostic[] {
		const { files } = this.placement;
		const below = new InstanceMap<RoutedFile[]>();
		for (const file of files)
			for (let length = 1; length < file.instancePath.length; length++) {
				const above = file.instancePath.slice(0, length);
				const landed = below.get(above);
				if (landed) landed.push(file);
				else below.set(above, [file]);
			}
		return files.flatMap((file) => {
			const { entry, instancePath } = file;
			const dir = path.posix.dirname(entry.source);
			const ownFolder = file.init
				? dir
				: path.posix.join(dir, instancePath.at(-1)!);
			const child = below
				.get(instancePath)
				?.find(({ entry }) => !isInside(entry.source, ownFolder));
			if (child === undefined) return [];
			const instance = instanceKey(instancePath);
			return [
				warningDiagnostic(
					"tree.instanceClash",
					{ resource: entry.source },
					`becomes "${instance}", where ${child.entry.source} lands too, so that file becomes a child of this one. Rename one of them to keep them apart.`,
					[],
					[
						{
							resource: child.entry.source,
							message: `becomes a child of "${instance}"`,
						},
					]
				),
			];
		});
	}

	private replacedInstance(): Diagnostic[] {
		return this.placement.clashes.flatMap(
			({ instance, winner, losers, initFolder }) =>
				losers.map((loser) =>
					// Rojo keeps both of two files of one name, which Rogen's tree can't, so the build would lose one: that stops the write. Of two init files Rojo itself reads one, as Rogen does, so that only warns.
					(initFolder === undefined
						? errorDiagnostic
						: warningDiagnostic)(
						"tree.instanceClash",
						{ resource: loser.entry.source },
						initFolder === undefined
							? `becomes "${instance}", as ${winner.entry.source} does, which takes its place, so the build would lose it. Rename one of them to keep both.`
							: `is an init file of ${initFolder}, as ${winner.entry.source} is, and Rojo reads only that one. ${WriteValidator.initFileFix(loser, instance)}`,
						[],
						[
							{
								resource: winner.entry.source,
								message: `takes its place as "${instance}"`,
							},
						]
					)
				)
		);
	}

	/** How to keep an init file Rojo doesn't read: by removing one when both land on one instance, else by naming its route with `@`. */
	private static initFileFix(
		{ entry, route, instancePath }: RoutedFile,
		instance: string
	): string {
		if (instanceKey(instancePath) === instance)
			return "Remove one of them.";
		const name = path.posix.basename(entry.source);
		const spelled = !DeclaredKeys.isName(route)
			? ""
			: `, as ${RojoFile.INIT_NAME}@${route}${name.slice(RojoFile.INIT_NAME.length)}`;
		return `To give each side its own init script, name them with @${spelled}.`;
	}

	private emptyName(): Diagnostic[] {
		return this.placement.files
			.filter(({ instancePath }) => instancePath.at(-1) === "")
			.map(({ entry }) =>
				warningDiagnostic(
					"scan.emptyName",
					{ resource: entry.source },
					"has no name once its suffix is taken off, so it becomes an instance with an empty name. Put a name before the suffix, as in Name.server.luau."
				)
			);
	}

	private portableName(): Diagnostic[] {
		return this.placement.roots
			.flatMap(({ oddNames }) => oddNames)
			.map(({ source, reason, leftOut }) =>
				warningDiagnostic(
					"scan.portableName",
					{ resource: source },
					`its name ${reason}. Rename it${leftOut ? " to put it in the game" : " so a checkout works on every system"}.`
				)
			);
	}

	private runContextTarget(): Diagnostic[] {
		if (!this.placement.tree.disablesLegacyScripts) return [];
		return this.placement.nodes
			.filter(
				(file) =>
					isPlayerScriptContainer(file.instancePath) &&
					(file.entry.file.ownRule === undefined ||
						file.entry.file.ownRule.use === "clientScript") &&
					this.assembly.meta.runContextOf(file.entry.source) ===
						undefined &&
					this.scriptRunOf(file) === "Client"
			)
			.map(({ entry, instancePath }) =>
				warningDiagnostic(
					"tree.runContextTarget",
					{ resource: entry.source },
					`lands in ${instancePath[1]}`
				)
			);
	}

	private nodeClash(): Diagnostic[] {
		const clashes = new Map<
			string,
			{ instance: string; kind: "file" | "folder" }
		>();
		for (const { file, node, source } of this.placement.displaced) {
			clashes.set(source, {
				instance: instanceKey(node),
				kind: source === file.entry.source ? "file" : "folder",
			});
		}
		return [...clashes].map(([resource, { instance, kind }]) =>
			warningDiagnostic(
				"tree.nodeClash",
				{ resource },
				`the tree defines "${instance}" too, so its node is kept and this ${kind} is left out. Rename one of them to keep both.`
			)
		);
	}

	private metaNotCopied(): Diagnostic[] {
		return this.assembly.metaOutcomes.flatMap((outcome) => {
			if (outcome.kind === "shared")
				return outcome.metas.map((meta) =>
					this.sharedWithFile(meta, outcome.file, outcome.instance)
				);
			if (outcome.kind === "treePath")
				return [this.metaOnTreePath(outcome.meta, outcome.instance)];
			return [];
		});
	}

	private metaOnTreePath(meta: FolderMeta, instance: string): Diagnostic {
		return warningDiagnostic(
			"meta.treePath",
			{ resource: meta.file },
			`the tree gives "${instance}" its own $path, so this meta isn't copied there. Set the fields on the tree's node instead.`
		);
	}

	private sharedWithFile(
		meta: FolderMeta,
		file: RoutedFile,
		instance: string
	): Diagnostic {
		const { entry } = file;
		const location = { resource: meta.file };
		const fileName = path.posix.basename(entry.relativePath);
		if (file.init)
			return warningDiagnostic(
				"meta.sharedWithScript",
				location,
				`this folder shares "${instance}" with ${entry.source}, the init script of another folder, which is what Rojo reads there, so its meta applies to nothing. Put it in ${joinPosix(file.init.sitsIn, RojoFile.INIT_META)} instead.`
			);
		const fix = entry.file.metaFile ?? `${fileName}${RojoFile.META_SUFFIX}`;
		return warningDiagnostic(
			"meta.sharedWithScript",
			location,
			`this folder shares "${instance}" with ${fileName}, which is what Rojo reads there, so its meta applies to nothing. Put it in ${fix} beside the script, or turn the folder into an init folder.`
		);
	}

	private treeClass(): Diagnostic[] {
		return this.assembly.metaOutcomes.flatMap((outcome) => {
			if (outcome.kind !== "copied") return [];
			const { instancePath, meta, treeNode } = outcome;
			if (
				treeNode.$className === undefined ||
				meta.fields.className === undefined ||
				treeNode.$className === meta.fields.className
			)
				return [];
			return [
				warningDiagnostic(
					"meta.treeClass",
					{ resource: meta.file },
					`the tree makes "${instanceKey(instancePath)}" a ${treeNode.$className}, so its class is kept over this meta's ${meta.fields.className}.`
				),
			];
		});
	}

	private metaAppliesToNothing(): Diagnostic[] {
		const metas = this.assembly.metaOutcomes.flatMap((outcome) =>
			outcome.kind === "appliesToNothing"
				? [[outcome.meta.file, outcome.folder] as const]
				: []
		);
		return metas.map(([resource, folder]) =>
			warningDiagnostic(
				"meta.appliesToNothing",
				{ resource },
				`applies to nothing, because ${folder} never becomes an instance. Move the meta into the folder that should get it.`
			)
		);
	}
}
