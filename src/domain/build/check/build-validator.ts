import path from "path";
import { compareStrings } from "../../../base/collections.js";
import { isObject } from "../../../base/objects.js";
import { isInside, joinPosix, toPosix } from "../../../base/path.js";
import { capitalized, joinedWithAnd } from "../../../base/strings.js";
import {
	Diagnostic,
	DiagnosticFix,
	DiagnosticRelated,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys } from "../../config/declared-keys.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	ScriptRun,
	WHERE_SCRIPTS_RUN,
	isServerOnlyService,
	scriptFate,
	instanceKey,
} from "../../roblox/roblox.js";
import { RojoFile, scriptRunOf } from "../../rojo/rojo.js";
import { RojoNode } from "../../rojo/rojo-project.js";
import { FolderMeta } from "../folder-meta.js";
import {
	MisspellingKind,
	MisspellingOf,
	NotedName,
} from "../misspelling-finder.js";
import { Placement } from "../placement.js";
import { RoutedFile } from "../router.js";
import { Assembly } from "../tree-assembler.js";

const ROJO_NODE_FIELDS: ReadonlySet<string> = new Set([
	"$className",
	"$path",
	"$properties",
	"$attributes",
	"$ignoreUnknownInstances",
	"$id",
]);

function reservedKeys(
	node: RojoNode,
	at: readonly string[]
): (readonly string[])[] {
	return Object.entries(node).flatMap(([key, value]) => {
		if (!isObject(value) || ROJO_NODE_FIELDS.has(key)) return [];
		const here = [...at, key];
		return [
			...(key.startsWith("$") ? [here] : []),
			...reservedKeys(value, here),
		];
	});
}

function renames(
	noted: ReadonlyMap<string, NotedName<unknown>>
): DiagnosticFix[] {
	return [...noted]
		.sort(([a], [b]) => compareStrings(a, b))
		.flatMap(([from, { renamedTo }]) =>
			renamedTo ? [{ rename: { from, to: renamedTo } }] : []
		);
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
			...this.runContextTarget(),
			...this.nodeClash(),
			...this.metaNotCopied(),
			...this.treeClass(),
			...this.metaAppliesToNothing(),
		];
	}

	private missingSourcePath(): Diagnostic[] {
		return this.placement.roots
			.filter((root) => !root.exists)
			.map((root) =>
				warningDiagnostic(
					"scan.missingSourcePath",
					{ resource: root.sourcePath },
					"this source path does not exist or is not a folder, so it contributes nothing."
				)
			);
	}

	private sourcePathNamedAfterKey(): Diagnostic[] {
		const configDir = path.dirname(this.config.file);
		const named = this.config.sourcePaths.flatMap((sourcePath) => {
			const key = this.config.keys.resolve(path.basename(sourcePath));
			if (key === undefined) return [];
			const parent = path.dirname(sourcePath);
			const relativeParent = toPosix(path.relative(configDir, parent));
			return [
				{
					sourcePath,
					shown: toPosix(path.relative(configDir, sourcePath)),
					key,
					parent: isInside(parent, configDir)
						? relativeParent
						: undefined,
				},
			];
		});
		if (named.length === 0) return [];

		const many = named.length > 1;
		const inside = named.filter(({ parent }) => parent !== undefined);
		const atTop = named.filter(({ parent }) => parent === undefined);
		const fixes = [
			...(inside.length > 0
				? [
						`Use ${joinedWithAnd([...new Set(inside.map(({ parent }) => `"${parent}"`))])} as the source path instead, so ${joinedWithAnd(inside.map(({ sourcePath }) => `"${path.basename(sourcePath)}"`))} ${inside.length > 1 ? "are" : "is"} read as ${inside.length > 1 ? "keys" : "a key"}.`,
					]
				: []),
			...(atTop.length > 0
				? [
						`Move ${atTop.length > 1 ? "them" : "it"} into one folder, such as ${joinedWithAnd(atTop.map(({ shown }) => `src/${shown}`))}, and use "sourcePaths": ["src"].`,
					]
				: []),
		];
		const items = named.map(({ sourcePath, shown, key }) => ({
			resource: sourcePath,
			message: `named after the "${key}" route`,
			line: `  ${shown} ("${key}" route)`,
		}));
		return [
			this.grouped(
				"scan.sourcePathNamedAfterKey",
				`${named.length} source ${many ? "paths are" : "path is"} named after a route key, but routing starts below a source path, so ${many ? "their names" : "its name"} route${many ? "" : "s"} nothing:`,
				items.map(({ line }) => line),
				items.map(({ resource, message }) => ({ resource, message })),
				fixes
			),
		];
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

	private nestedProject(): Diagnostic[] {
		return this.placement.files
			.filter(
				({ entry }) =>
					path.posix.basename(entry.relativePath) ===
					"default.project.json"
			)
			.map(({ entry, instancePath }) =>
				warningDiagnostic(
					"scan.nestedProject",
					{ resource: entry.source },
					`Rojo reads this project file as a nested project, so it becomes ${instanceKey(instancePath)}, holding that project's tree. A project file for the folder it lies in belongs outside the source paths.`
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
			(count) =>
				`${count} ${count === 1 ? "name has" : "names have"} an "@" that routes nowhere, so ${count === 1 ? "it is read as an ordinary name" : "they are read as ordinary names"}:`,
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
			(count) =>
				`${count} ${count > 1 ? "names write" : "name writes"} a route key after a dot, where only "@" routes, so ${count > 1 ? "they route" : "it routes"} nothing:`,
			(resource, { renamedTo }) =>
				`write "${path.posix.basename(renamedTo ?? resource)}"`
		);
	}

	private folderTypo(): Diagnostic[] {
		return this.misspelt(
			"route.folderTypo",
			"folderTypo",
			(count) =>
				`${count} ${count > 1 ? "folders are" : "folder is"} one edit from a declared route key, so ${count > 1 ? "they are read as ordinary folders" : "it is read as an ordinary folder"}:`,
			(_, { key }) => `did you mean "${key}"?`
		);
	}

	private misspelt<K extends MisspellingKind>(
		code: string,
		kind: K,
		headline: (count: number) => string,
		hint: (
			resource: string,
			misspelt: NotedName<MisspellingOf<K>>
		) => string
	): Diagnostic[] {
		const noted = this.placement.readings.misspelt(kind);
		if (noted.size === 0) return [];
		const items = [...noted].map(([resource, misspelt]) => ({
			resource,
			message: hint(resource, misspelt),
		}));
		return [
			this.grouped(
				code,
				headline(noted.size),
				items.map(
					({ resource, message }) => `  ${resource} (${message})`
				),
				items,
				[],
				renames(noted)
			),
		];
	}

	private unrouted(): Diagnostic[] {
		return this.placement.leftOut
			.withStatus("unrouted")
			.map(([resource]) =>
				warningDiagnostic(
					"route.unrouted",
					{ resource },
					'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
				)
			);
	}

	private shipped(): { file: RoutedFile; ignored: string[] }[] {
		const { routes } = this.config;
		return this.placement.files.flatMap((file) => {
			const ignored = [...new Set(file.outrankedFolderRoutes)].filter(
				(key) => {
					const service = routes.get(key)?.service;
					return (
						service !== undefined && isServerOnlyService(service)
					);
				}
			);
			const isScript =
				this.placement.readingOf(file).scriptSuffix !== undefined;
			return ignored.length > 0 &&
				!isScript &&
				!isServerOnlyService(file.instancePath[0])
				? [{ file, ignored }]
				: [];
		});
	}

	private serverCodeShipped(): Diagnostic[] {
		const shipped = this.shipped();
		if (shipped.length === 0) return [];

		const quoted = (keys: Iterable<string>) =>
			joinedWithAnd([...new Set(keys)].map((key) => `"${key}"`));
		const ignoredKeys = quoted(shipped.flatMap(({ ignored }) => ignored));
		const routeKeys = [...new Set(shipped.map(({ file }) => file.route))];
		const governing = quoted(routeKeys);
		const related = shipped.map(({ file }) => ({
			resource: file.entry.source,
			message: `ships to clients as ${instanceKey(file.instancePath)}`,
		}));
		const listed = shipped.map(
			({ file }) =>
				`  ${file.entry.source} -> ${instanceKey(file.instancePath)}`
		);
		const many = shipped.length > 1;
		const marker =
			routeKeys.length === 1
				? `a "@${routeKeys[0]}" marker file`
				: `a marker file that restates their route (${routeKeys.map((key) => `"@${key}"`).join(" or ")})`;
		return [
			this.grouped(
				"route.serverCodeShipped",
				`${shipped.length} ${many ? "files" : "file"} under a ${ignoredKeys} route ${many ? "ship" : "ships"} to clients, because ${governing} ${governing.includes(" and ") ? "govern" : "governs"} ${many ? "them" : "it"}:`,
				listed,
				related,
				[
					`Move ${many ? "them" : "it"} out of the ${governing} route's files if ${many ? "they're" : "it's"} server code, or keep ${many ? "them" : "it"} there with ${marker} in ${many ? "their" : "its"} folder.`,
				]
			),
		];
	}

	private deadScript(): Diagnostic[] {
		const dead = this.placement.files.flatMap((file) => {
			const run = this.scriptRunOf(file);
			return run !== undefined &&
				scriptFate(run, file.instancePath) === "neverRuns"
				? [{ file, run }]
				: [];
		});
		if (dead.length === 0) return [];

		const related = dead.map(({ file, run }) => ({
			resource: file.entry.source,
			message: `${BuildValidator.describeRun(run)} never runs in ${file.instancePath[0]}`,
		}));
		const listed = dead.map(
			({ file, run }) =>
				`  ${file.entry.source} -> ${instanceKey(file.instancePath)} (${BuildValidator.describeRun(run)}, placed by the "${file.route}" route)`
		);
		const many = dead.length > 1;
		return [
			this.grouped(
				"tree.deadScript",
				`${dead.length} ${many ? "scripts" : "script"} will never run where ${many ? "they land" : "it lands"}:`,
				listed,
				related,
				[WHERE_SCRIPTS_RUN]
			),
		];
	}

	private grouped(
		code: string,
		headline: string,
		lines: readonly string[],
		related: readonly DiagnosticRelated[],
		tail: readonly string[] = [],
		fixes: readonly DiagnosticFix[] = []
	): Diagnostic {
		return warningDiagnostic(
			code,
			{ resource: this.config.file },
			[headline, ...lines, ...tail].join("\n"),
			fixes,
			related
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
		const { routed } = this.placement;
		return reservedKeys(this.assembly.projectFile.tree, []).flatMap(
			(key) => {
				const under = routed.filter(({ instancePath }) =>
					key.every((name, index) => instancePath[index] === name)
				);
				const file =
					under.find(
						({ instancePath }) => instancePath.length === key.length
					) ?? under[0];
				if (!file) return [];
				const fileName = path.posix.basename(file.entry.source);
				const renamable =
					file.instancePath.length === key.length &&
					file.init === undefined &&
					fileName.startsWith("$") &&
					fileName.length > 1;
				return [
					warningDiagnostic(
						"tree.reservedName",
						{ resource: file.entry.source },
						`the project file gets the instance "${instanceKey(key)}", and Rojo reserves a leading $ for its own fields, so it warns of it on every build. Rename ${file.instancePath.length === key.length && file.init === undefined ? "the file" : "the folder"} without the $.`,
						renamable
							? [
									{
										rename: {
											from: file.entry.source,
											to: path.posix.join(
												path.posix.dirname(
													file.entry.source
												),
												fileName.slice(1)
											),
										},
									},
								]
							: []
					),
				];
			}
		);
	}

	private instanceClash(): Diagnostic[] {
		return this.placement.clashes.flatMap(({ instance, winner, losers }) =>
			losers.map(({ entry }) =>
				warningDiagnostic(
					"tree.instanceClash",
					{ resource: entry.source },
					`becomes "${instance}", as ${winner.entry.source} does, which takes its place. Rename one of them to keep both.`
				)
			)
		);
	}

	private runContextTarget(): Diagnostic[] {
		if (!this.placement.tree.disablesLegacyScripts) return [];
		const routes = [...this.config.routes]
			.filter(([, target]) => target.isPlayerScripts)
			.map(([key, target]) => `"${key}" → ${target}`);
		return routes.length > 0
			? [
					warningDiagnostic(
						"tree.runContextTarget",
						{ resource: this.config.projectFile },
						`emitLegacyScripts: false in the tree isn't supported with routes that target StarterPlayerScripts or StarterCharacterScripts (${routes.join(", ")}). Route ${routes.length === 1 ? "it" : "them"} to another service, or remove emitLegacyScripts from the tree.`
					),
				]
			: [];
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
				return [
					warningDiagnostic(
						"meta.treePath",
						{ resource: outcome.meta.file },
						`the tree gives "${outcome.instance}" its own $path, so this meta isn't copied there. Set the fields on the tree's node instead.`
					),
				];
			return [];
		});
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
		const fix =
			new RojoFile(fileName).metaFile ??
			`${fileName}${RojoFile.META_SUFFIX}`;
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
