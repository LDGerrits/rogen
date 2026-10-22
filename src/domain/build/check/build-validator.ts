import path from "path";
import { compareStrings } from "../../../base/collections.js";
import { isObject } from "../../../base/objects.js";
import { isInside, joinPosix, toPosix } from "../../../base/path.js";
import { capitalized, joinedWithOr } from "../../../base/strings.js";
import {
	Diagnostic,
	DiagnosticFix,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys } from "../../config/declared-keys.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	ScriptRun,
	isServerOnlyService,
	scriptFate,
	instanceKey,
} from "../../roblox/roblox.js";
import { RojoFile, scriptRunOf } from "../../rojo/rojo.js";
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

/** Reports on a finished build without re-deciding what its phases decided. */
export class BuildValidator {
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
			...this.extensionCase(),
			...this.syncRuleSuffix(),
			...this.nestedProject(),
			...this.unclaimedMeta(),
			...this.caseMismatch(),
			...this.strayAt(),
			...this.dotRoute(),
			...this.folderTypo(),
			...this.unrouted(),
			...this.serverCodeShipped(),
			...this.deadScript(),
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
					`Rojo reads a ${entry.file.name} as the folder it lies in, but a source path never becomes an instance, so this project becomes ${instanceKey(instancePath)} on its own. Move it into a folder of its own.`
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

	private caseMismatch(): Diagnostic[] {
		const { nearMisses } = this.placement.readings;
		return [...nearMisses].map(([resource, key]) => {
			return warningDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the route "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${DeclaredKeys.flipFirstLetter(key)}", or declare it as written.`
			);
		});
	}

	private strayAt(): Diagnostic[] {
		return this.misspelt(
			"route.strayAt",
			"strayAt",
			(_, { text, suggestion, notLast }) =>
				notLast
					? `"@${text}" must end the name`
					: `did you mean "${suggestion}"?`
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
			if (route === key || route === DeclaredKeys.FALLBACK_ROUTE)
				return false;
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

	private folderTypo(): Diagnostic[] {
		return this.misspelt(
			"route.folderTypo",
			"folderTypo",
			(_, { key }) => `did you mean "${key}"?`
		);
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
					`matched no route, so it is left out. Move it into ${joinedWithOr([path.join(this.featureFolderOf(resource), first), ...rest])}, end its name with a route's @ marker (${joinedWithOr([first, ...rest].map((key) => `@${key}`))}), or declare a "*" route.`
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
				`${BuildValidator.describeRun(run)} never runs in ${file.instancePath[0]}`
			)
		);
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
						`the project file gets the instance "${instanceKey(key)}", and Rojo reserves a leading $ for its own fields, so it warns of it on every build. Rename ${isTheNode ? "the file" : "the folder"} without the $.`,
						isTheNode ? BuildValidator.withoutDollar(file) : []
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
		return this.placement.clashes.flatMap(({ instance, winner, losers }) =>
			losers.map(({ entry }) =>
				warningDiagnostic(
					"tree.instanceClash",
					{ resource: entry.source },
					`becomes "${instance}", as ${winner.entry.source} does, which takes its place. Rename one of them to keep both.`,
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
		return this.placement.playerClientScripts.inits
			.filter(
				({ entry }) =>
					this.assembly.meta.runContextOf(entry.source) === undefined
			)
			.map(({ entry }) =>
				warningDiagnostic(
					"tree.runContextTarget",
					{ resource: entry.source },
					"an init script that sync rules can't keep a LocalScript"
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
