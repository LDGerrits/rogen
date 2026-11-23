import path from "path";
import { compareByCodePoint } from "../../../base/collections.js";
import { ancestors, isInside, joinPosix, toPosix } from "../../../base/path.js";
import { capitalized, joinedBriefly } from "../../../base/strings.js";
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
import { RojoProject } from "../../rojo/rojo-project.js";
import { FolderMeta } from "../folder-meta.js";
import {
	MisspellingKind,
	MisspellingOf,
	NotedName,
} from "../misspelling-finder.js";
import { Placement } from "../placement.js";
import { MissingSourcePaths } from "./missing-source-paths.js";
import { RoutedFile } from "../router.js";
import { ScannedFile } from "../root-scanner.js";
import { Assembly } from "../tree-assembler.js";

const SCRIPT_SUFFIX_BEFORE_AT = new RegExp(
	`^(?<stem>.+)\\.(?<suffix>${SCRIPT_SUFFIXES.join("|")})@[^.@]+(?<extension>\\.[^.@]+)$`
);

const LISTED_FILES = 3;

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
			...this.folderPattern(),
			...this.unrouted(),
			...this.shippedByFolder(),
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
				? `use "${toPosix(path.relative(configDir, parent))}" as the source path instead`
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
			.sort(compareByCodePoint)
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
							'is TypeScript, and the config has no "compiledPath". Set "compiledPath" to the folder roblox-ts writes, as "out", or remove the file.'
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
				? `Set "compiledPath" to the folder roblox-ts writes, as "out".${others ? ' For the other files, add a "syncRules" entry for their extension.' : ""}`
				: !compiled
					? 'Add a "syncRules" entry for their extension, and a "compiledPath" if a compiler compiles them.'
					: 'Add a "syncRules" entry for their extension.';
		return `Rojo reads none of its files (${listed}). ${advice}`;
	}

	private syncRuleSuffix(): Diagnostic[] {
		return this.placement.roots
			.flatMap(({ entries }) => entries)
			.sort((a, b) => compareByCodePoint(a.source, b.source))
			.flatMap(({ source, file }) => {
				const rule = file.suffixMissedBy;
				return rule
					? [
							warningDiagnostic(
								"scan.syncRuleSuffix",
								{ resource: source },
								`the sync rule "${rule.pattern}" cuts "${rule.suffix}" off a file name, but this name does not end with it. Make the suffix end every file the pattern matches.`
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
			.sort(([a], [b]) => compareByCodePoint(a, b))
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
					`belongs to no file, so Rojo ignores it. ${hint ? `${capitalized(hint)}.` : "Name a meta after its file, without .server, .client or .plugin."}`
				)
			);
	}

	private dotRoute(): Diagnostic[] {
		return this.misspelt(
			"route.dotRoute",
			"dotRoute",
			(resource, { renamedTo }) =>
				`write "${path.posix.basename(renamedTo!)}"`,
			(resource, { key, respelling }) => {
				if (!respelling.spelling.startsWith("@")) return undefined;
				const governing = this.governingRoute(resource, key);
				return governing === undefined
					? undefined
					: `the "${governing}" route governs it, so "@${key}" would do nothing; move it out of that route's files to route it`;
			}
		);
	}

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

	private folderPattern(): Diagnostic[] {
		const { patterns } = this.config;
		const scripts = new Map<string, string>();
		const plain = new Set<string>();
		for (const { entry, routeMatch, init } of this.placement.files)
			if (routeMatch !== "fallback") continue;
			else if (init)
				scripts.set(init.becomes, asFileOf(init.becomes, entry.source));
			else for (const folder of foldersAbove(entry)) plain.add(folder);
		const matched = [...new Set([...scripts.keys(), ...plain])]
			.sort(compareByCodePoint)
			.flatMap((folder) => {
				const asFile = scripts.get(folder);
				const match = patterns.match(
					path.posix.basename(folder),
					...(asFile === undefined ? [] : [asFile])
				);
				const script = asFile !== undefined;
				return match?.kind === "routed" &&
					(script || !match.key.includes("*")) &&
					!this.placement.readings.isMistyped(folder)
					? [{ folder, script, pattern: match.key }]
					: [];
			});
		return matched
			.filter(
				({ folder }) =>
					!matched.some((outer) => isInside(folder, outer.folder))
			)
			.map(({ folder, script, pattern }) => {
				const name = path.posix.basename(folder);
				const key = patterns.nameKeyFor(pattern);
				const renamable = key !== undefined && /^[^^(]/.test(name);
				return warningDiagnostic(
					"route.folderPattern",
					{ resource: folder },
					`matches the pattern "${pattern}", but a pattern never routes a folder${script ? " or its init script, so it goes" : ", so its unrouted files go"} to "*". ${key === undefined ? 'No name key routes to that place: add one to "routes" and name the folder for it.' : `Name it ${name}@${key} to route it there.`}`,
					renamable
						? [{ rename: { from: folder, to: `${folder}@${key}` } }]
						: []
				);
			});
	}

	private misspelt<K extends MisspellingKind>(
		code: string,
		kind: K,
		hint: (
			resource: string,
			misspelt: NotedName<MisspellingOf<K>>
		) => string,
		unusable: (
			resource: string,
			misspelt: NotedName<MisspellingOf<K>>
		) => string | undefined
	): Diagnostic[] {
		return [...this.placement.readings.misspelt(kind)].map(
			([resource, misspelt]) => {
				const why = unusable(resource, misspelt);
				const { renamedTo } = misspelt;
				return errorDiagnostic(
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
		const [first] = this.config.keys.routeKeys;
		return this.placement.leftOut
			.withStatus("unrouted")
			.map(([resource]) =>
				warningDiagnostic(
					"route.unrouted",
					{ resource },
					`matched no route, so it is left out. Move it into a routing folder such as ${path.join(this.featureFolderOf(resource), first)}, end its name with @${first}, or declare a "*" route.`
				)
			);
	}

	private featureFolderOf(source: string): string {
		const sourcePath = this.config.sourcePaths.find((dir) =>
			isInside(source, dir)
		)!;
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

	private outrankedSuffix(file: RoutedFile): string {
		const suffix = this.placement.readingOf(file).scriptSuffix!;
		const key = this.config.keys.resolveDotRoute(suffix);
		if (key === undefined)
			return `: no route is named "${suffix}", so ".${suffix}" routes nothing`;
		return key === file.route
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
		return `the sync rule "${rule.pattern}" makes this file a ModuleScript, so it never runs. Add a "${named}Script" rule for "*.${named}${extension}" before it, or remove ".${named}".`;
	}

	private static compiledClassMismatch(file: RojoFile): string | undefined {
		const emitted = file.renamed(`${file.stem}.luau`);
		if (
			emitted.ownRule &&
			(emitted.kind !== file.kind ||
				emitted.scriptSuffix !== file.scriptSuffix ||
				emitted.instanceName !== file.instanceName)
		)
			return `the sync rule "${emitted.ownRule.pattern}" also takes the compiled ${emitted.name}, so Rojo reads it by the rule. Narrow the pattern to the source extension.`;
		const { ownRule: rule, scriptSuffix: given } = file.uncompiled;
		if (!rule || !given || given === RojoFile.scriptSuffixOf(file.stem))
			return undefined;
		const renamed = `${RojoFile.scriptNameOf(file.stem)}.${given}${path.extname(file.name)}`;
		return `the sync rule "${rule.pattern}" asks for a ${given} script, but the compiled ${emitted.name} is a ModuleScript. Rename it ${renamed}, or set the rule's "use" to "moduleScript".`;
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
				? `rename it ${named}`
				: `name it ${named} in a routing folder`;
			return [
				warningDiagnostic(
					"route.scriptSuffixBeforeAt",
					{ resource: file.entry.source },
					`Rojo reads ".${suffix}" only at the end of a name, so this is a ModuleScript. For a Script, ${script}; for a module, remove ".${suffix}".`,
					suffixRoutesHere && !scanned.has(to)
						? [{ rename: { from: file.entry.source, to } }]
						: []
				),
			];
		});
	}

	private reservedName(): Diagnostic[] {
		return RojoProject.findReservedKeys(
			this.assembly.projectFile.tree,
			[]
		).flatMap((key) => {
			if (this.config.project.getNode(key)) return [];
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
		});
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
					`becomes "${instance}", and ${child.entry.source} lands inside it as a child. Rename one of them to keep them apart.`,
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
					(initFolder === undefined
						? errorDiagnostic
						: warningDiagnostic)(
						"tree.instanceClash",
						{ resource: loser.entry.source },
						initFolder === undefined
							? `becomes "${instance}", like ${winner.source}, which takes its place. ${loser.init !== undefined && winner.isInit ? "Remove one of them." : "Rename one of them to keep both."}`
							: `is an init file of ${initFolder}, like ${winner.source}, and Rojo reads only one. ${WriteValidator.initFileFix(loser, instance)}`,
						[],
						[
							{
								resource: winner.source,
								message: `takes its place as "${instance}"`,
							},
						]
					)
				)
		);
	}

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
					"has no name before its suffix. Put a name before it, as in Name.server.luau."
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
		return this.placement.files
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
			if (outcome.kind === "fileAtNode")
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
				`this folder shares "${instance}" with ${entry.source}, the init script of another folder, so its meta applies to nothing. Put it in ${joinPosix(file.init.sitsIn, RojoFile.INIT_META)} instead.`
			);
		const fix = entry.file.metaFile ?? `${fileName}${RojoFile.META_SUFFIX}`;
		return warningDiagnostic(
			"meta.sharedWithScript",
			location,
			`this folder shares "${instance}" with ${fileName}, so its meta applies to nothing. Put it in ${fix} beside the script, or turn the folder into an init folder.`
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

function asFileOf(folder: string, source: string): string {
	const fileName = path.posix.basename(source);
	return path.posix.basename(folder) + fileName.slice(fileName.indexOf("."));
}

function foldersAbove({ source, relativePath }: ScannedFile): string[] {
	return [...ancestors(source)].slice(0, relativePath.split("/").length - 1);
}
