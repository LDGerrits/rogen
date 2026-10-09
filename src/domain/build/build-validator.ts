import path from "path";
import { compareStrings } from "../../base/collections.js";
import { joinPosix, toPosix } from "../../base/path.js";
import {
	capitalized,
	joinedWithAnd,
	joinedWithOr,
} from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticFix,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import {
	ScriptRun,
	WHERE_SCRIPTS_RUN,
	isServerOnlyService,
	scriptFate,
} from "../roblox/roblox.js";
import { RojoFile, scriptRunOf } from "../rojo/rojo.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { FolderMeta } from "./folder-meta.js";
import { MisspellingKind, MisspellingOf, NotedName } from "./name-reader.js";
import { MissingInstances } from "./missing-instances.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { Assembly } from "./tree-assembler.js";

/** A rename for every noted name that has one, not only the names a message lists. */
function renames(
	noted: ReadonlyMap<string, NotedName<unknown>>
): DiagnosticFix[] {
	return [...noted]
		.sort(([a], [b]) => compareStrings(a, b))
		.flatMap(([from, { renamedTo }]) =>
			renamedTo ? [{ rename: { from, to: renamedTo } }] : []
		);
}

/** Reports on a finished build. It works out what to say from what the phases hold, but never re-decides what they decided. */
export class BuildValidator {
	private readonly placement: Placement;
	private readonly config: ResolvedConfig;

	constructor(private readonly assembly: Assembly) {
		this.placement = assembly.placement;
		this.config = assembly.placement.config;
	}

	/** One warning list, in the order the rules run. */
	validate(): Diagnostic[] {
		return [
			...this.missingRootDir(),
			...this.rootDirNamedAfterKey(),
			...this.unresolvedLink(),
			...this.unclaimedMeta(),
			...this.caseMismatch(),
			...this.strayAt(),
			...this.dotRoute(),
			...this.variantTypo(),
			...this.folderTypo(),
			...this.noneActive(),
			...this.unrouted(),
			...this.serverCodeShipped(),
			...this.deadScript(),
			...this.buriedScriptSuffix(),
			...this.instanceClash(),
			...this.runContextTarget(),
			...this.templateClash(),
			...this.metaNotCopied(),
			...this.templateClass(),
			...this.metaAppliesToNothing(),
		];
	}

	private missingRootDir(): Diagnostic[] {
		return this.placement.roots
			.filter((root) => !root.exists)
			.map((root) =>
				warningDiagnostic(
					"scan.missingRootDir",
					{ resource: root.rootDir },
					"this root dir does not exist, so it contributes nothing."
				)
			);
	}

	/** Routing starts below a root dir, so a root dir named like a key routes or prunes nothing by that name. */
	private rootDirNamedAfterKey(): Diagnostic[] {
		const configDir = path.dirname(this.config.file);
		const named = this.config.rootDirs.flatMap((rootDir) => {
			const key = this.config.keys.resolve(path.basename(rootDir));
			if (key === undefined) return [];
			const parent = path.dirname(rootDir);
			const relativeParent = toPosix(path.relative(configDir, parent));
			return [
				{
					rootDir,
					shown: toPosix(path.relative(configDir, rootDir)),
					key,
					kind: this.config.keys.kindOf(key),
					// A parent inside the project can be the root dir itself; the config's own folder or one above it would scan far too much.
					parent:
						relativeParent !== "" &&
						!relativeParent.startsWith("..")
							? relativeParent
							: undefined,
				},
			];
		});
		if (named.length === 0) return [];

		const kinds = new Set(named.map(({ kind }) => kind));
		const many = named.length > 1;
		const keyKind = joinedWithOr(
			(["route", "variant", "mode"] as const).filter((kind) =>
				kinds.has(kind)
			)
		);
		const effect =
			kinds.has("route") && kinds.size > 1
				? "do nothing"
				: kinds.has("route")
					? `route${many ? "" : "s"} nothing`
					: `prune${many ? "" : "s"} nothing`;
		const inside = named.filter(({ parent }) => parent !== undefined);
		const atTop = named.filter(({ parent }) => parent === undefined);
		const fixes = [
			...(inside.length > 0
				? [
						`Use ${joinedWithAnd([...new Set(inside.map(({ parent }) => `"${parent}"`))])} as the root dir instead, so ${joinedWithAnd(inside.map(({ rootDir }) => `"${path.basename(rootDir)}"`))} ${inside.length > 1 ? "are" : "is"} read as ${inside.length > 1 ? "keys" : "a key"}.`,
					]
				: []),
			...(atTop.length > 0
				? [
						`Move ${atTop.length > 1 ? "them" : "it"} into one folder, such as ${joinedWithAnd(atTop.map(({ shown }) => `src/${shown}`))}, and use "rootDirs": ["src"].`,
					]
				: []),
		];
		const items = named.map(({ rootDir, shown, key, kind }) => ({
			resource: rootDir,
			message: `named after the "${key}" ${kind}`,
			line: `  ${shown} ("${key}" ${kind})`,
		}));
		return [
			warningDiagnostic(
				"scan.rootDirNamedAfterKey",
				{ resource: this.config.file },
				[
					`${named.length} root ${many ? "dirs are" : "dir is"} named after a ${keyKind} key, but routing starts below a root dir, so ${many ? "their names" : "its name"} ${effect}:`,
					...items.map(({ line }) => line),
					...fixes,
				].join("\n"),
				[],
				items.map(({ resource, message }) => ({ resource, message }))
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
			const kind = this.config.keys.kindOf(key);
			return warningDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${DeclaredKeys.flipFirstLetter(key)}", or declare it as written.`
			);
		});
	}

	/** An `@` means nothing else, so one that routes nowhere is a typo or a misplaced suffix. */
	private strayAt(): Diagnostic[] {
		return this.misspelt(
			"route.strayAt",
			"strayAt",
			(count) =>
				`${count} ${count === 1 ? "name has" : "names have"} an "@" that routes nowhere, so ${count === 1 ? "it is read as an ordinary name" : "they are read as ordinary names"}:`,
			(_, { text, suggestion, notLast }) =>
				notLast
					? `"@${text}" must end the name, or be followed only by a variant`
					: `did you mean "${suggestion}"?`
		);
	}

	/** A route key after a dot routes nothing, so what it names falls through to the route above it. */
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

	/** A dot part one edit from a declared variant or mode, or a folder one edit from one, is probably that key, mistyped. */
	private variantTypo(): Diagnostic[] {
		const typos = [
			...this.placement.readings.misspelt("variantTypo").values(),
		];
		const bare = typos.some((typo) => typo.bare);
		const modes = typos.filter(({ variant }) =>
			this.config.keys.isMode(variant)
		).length;
		const noun =
			modes === 0
				? "variant"
				: modes === typos.length
					? "mode"
					: "variant or mode";
		return this.misspelt(
			"variant.typo",
			"variantTypo",
			(count) =>
				bare
					? `${count} ${count > 1 ? "names are" : "name is"} one edit from a declared ${noun}, so ${count > 1 ? "they are read as ordinary names" : "it is read as an ordinary name"}:`
					: `${count} ${count > 1 ? "names end" : "name ends"} in a dot part that is one edit from a declared ${noun}, so ${count > 1 ? "they are read as ordinary names" : "it is read as an ordinary name"}:`,
			(_, { variant, bare }) =>
				`did you mean "${bare ? variant : `.${variant}`}"?`
		);
	}

	/** A folder one edit from a declared route key falls through to the route above it, as its files would not if it were spelt right. */
	private folderTypo(): Diagnostic[] {
		return this.misspelt(
			"route.folderTypo",
			"folderTypo",
			(count) =>
				`${count} ${count > 1 ? "folders are" : "folder is"} one edit from a declared route key, so ${count > 1 ? "they are read as ordinary folders" : "it is read as an ordinary folder"}:`,
			(_, { key }) => `did you mean "${key}"?`
		);
	}

	/** One warning for every name with a misspelling of `kind`: `headline` for how many, then a line for each, and the renames that fix them. */
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
			warningDiagnostic(
				code,
				{ resource: this.config.file },
				[
					headline(noted.size),
					...items.map(
						({ resource, message }) => `  ${resource} (${message})`
					),
				].join("\n"),
				renames(noted),
				items
			),
		];
	}

	/** Variants are independent switches, so turning off every alternative of an instance leaves nothing where code expects it. */
	private noneActive(): Diagnostic[] {
		return new MissingInstances(this.placement).diagnostics();
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

	/** The files a bare server routing folder holds but a replicating route governs, with the server routes ignored. */
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
			// A Script's source stays on the server, and a LocalScript is client code to begin with.
			const isScript =
				this.placement.readings.entryAt(file.entry.source)
					.scriptSuffix !== undefined;
			return ignored.length > 0 &&
				!isScript &&
				!isServerOnlyService(file.instancePath[0])
				? [{ file, ignored }]
				: [];
		});
	}

	/** A bare server routing folder that an outer route outranks is an ordinary folder, which sends its modules to clients when the outer route replicates. */
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
			warningDiagnostic(
				"route.serverCodeShipped",
				{ resource: this.config.file },
				[
					`${shipped.length} ${many ? "files" : "file"} under a ${ignoredKeys} route ${many ? "ship" : "ships"} to clients, because ${governing} ${governing.includes(" and ") ? "govern" : "governs"} ${many ? "them" : "it"}:`,
					...listed,
					`Move ${many ? "them" : "it"} out of the ${governing} route's files if ${many ? "they're" : "it's"} server code, or keep ${many ? "them" : "it"} there with ${marker} in ${many ? "their" : "its"} folder.`,
				].join("\n"),
				[],
				related
			),
		];
	}

	/** A script that its class or run context and its service rule out running. ServerStorage holds scripts that code clones out, so it never counts. */
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
			warningDiagnostic(
				"tree.deadScript",
				{ resource: this.config.file },
				[
					`${dead.length} ${many ? "scripts" : "script"} will never run where ${many ? "they land" : "it lands"}:`,
					...listed,
					WHERE_SCRIPTS_RUN,
				].join("\n"),
				[],
				related
			),
		];
	}

	private scriptRunOf(file: RoutedFile): ScriptRun | undefined {
		return scriptRunOf(
			this.placement.readings.entryAt(file.entry.source).scriptSuffix,
			!this.placement.template.disablesLegacyScripts,
			this.assembly.meta.runContextOf(file.entry.source)
		);
	}

	private static describeRun(run: ScriptRun): string {
		return run === "Script" || run === "LocalScript"
			? `a ${run}`
			: `a Script with RunContext ${run}`;
	}

	private buriedScriptSuffix(): Diagnostic[] {
		const { routed, leftOut } = this.placement;
		return routed.flatMap(({ entry, buriedScriptSuffix: suffix }) =>
			suffix && leftOut.get(entry.source)?.status !== "pruned"
				? [
						warningDiagnostic(
							"variant.buriedScriptSuffix",
							{ resource: entry.source },
							`".${suffix}" isn't this file's last suffix, so Rojo will make it a ModuleScript. Put it last, as in Foo.mock.${suffix}.luau.`
						),
					]
				: []
		);
	}

	/** Only one plain file can become an instance; a variant file replacing it is the point of variants. */
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

	/** Rojo can't give scripts a run context there, so they'd never run. */
	private runContextTarget(): Diagnostic[] {
		if (!this.placement.template.disablesLegacyScripts) return [];
		const routes = [...this.config.routes]
			.filter(([, target]) => target.isPlayerScripts)
			.map(([key, target]) => `"${key}" → ${target}`);
		return routes.length > 0
			? [
					warningDiagnostic(
						"tree.runContextTarget",
						{ resource: this.config.outFile },
						`emitLegacyScripts: false in the template isn't supported with routes that target StarterPlayerScripts or StarterCharacterScripts (${routes.join(", ")}). Route ${routes.length === 1 ? "it" : "them"} to another service, or remove emitLegacyScripts from the template.`
					),
				]
			: [];
	}

	/** One warning per file or folder the template displaced. */
	private templateClash(): Diagnostic[] {
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
				"tree.templateClash",
				{ resource },
				`the template defines "${instance}" too, so its node is kept and this ${kind} is left out. Rename one of them to keep both.`
			)
		);
	}

	/** Folder meta the build couldn't copy: a file is what Rojo reads at the node, or the template's `$path` is. */
	private metaNotCopied(): Diagnostic[] {
		return this.assembly.metaOutcomes.flatMap((outcome) => {
			if (outcome.kind === "shared")
				return outcome.metas.map((meta) =>
					this.sharedWithFile(meta, outcome.file, outcome.instance)
				);
			if (outcome.kind === "templatePath")
				return [
					warningDiagnostic(
						"meta.templatePath",
						{ resource: outcome.meta.file },
						`the template gives "${outcome.instance}" its own $path, so this meta isn't copied there. Set the fields on the template's node instead.`
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

	private templateClass(): Diagnostic[] {
		return this.assembly.metaOutcomes.flatMap((outcome) => {
			if (outcome.kind !== "copied") return [];
			const { instancePath, meta, templateNode } = outcome;
			if (
				templateNode.$className === undefined ||
				meta.className === undefined ||
				templateNode.$className === meta.className
			)
				return [];
			return [
				warningDiagnostic(
					"meta.templateClass",
					{ resource: meta.file },
					`the template makes "${instanceKey(instancePath)}" a ${templateNode.$className}, so its class is kept over this meta's ${meta.className}.`
				),
			];
		});
	}

	/** Meta in folders that never become an instance. */
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
