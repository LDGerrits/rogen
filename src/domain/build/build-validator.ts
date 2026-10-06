import path from "path";
import { compareStrings } from "../../base/collections.js";
import { joinPosix } from "../../base/path.js";
import { capitalized, joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import {
	ScriptRun,
	WHERE_SCRIPTS_RUN,
	isServerOnlyService,
	scriptFate,
} from "../roblox/roblox.js";
import { RojoFile, RojoScriptSuffix, scriptRunOf } from "../rojo/rojo.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { FolderMeta } from "./folder-meta.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { Assembly } from "./tree-assembler.js";

const DIAGNOSED_PATHS = 10;

/** Reports on a finished build and decides nothing. */
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
			...this.unresolvedLink(),
			...this.unclaimedMeta(),
			...this.caseMismatch(),
			...this.strayAt(),
			...this.variantTypo(),
			...this.unrouted(),
			...this.serverCodeShipped(),
			...this.ignoredAt(),
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
		return this.diagnosePaths(
			this.placement
				.unclaimedMeta()
				.map(({ path, hint }) => [path, hint]),
			(resource, hint) =>
				warningDiagnostic(
					"meta.unclaimed",
					{ resource },
					`belongs to no file, so Rojo ignores it. ${hint ? `${capitalized(hint)}.` : "A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin."}`
				)
		);
	}

	/** A folder or marker that only differs from a declared key in letter case is read as an ordinary name. */
	private caseMismatch(): Diagnostic[] {
		const { nearMisses } = this.placement.readings;
		return this.diagnosePaths([...nearMisses], (resource, key) => {
			const kind = this.config.keys.isVariant(key) ? "variant" : "route";
			return warningDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${DeclaredKeys.flipFirstLetter(key)}", or declare it as written.`
			);
		});
	}

	/** An `@` means nothing else, so one that routes nowhere is a typo or a misplaced suffix. */
	private strayAt(): Diagnostic[] {
		const { strayAts } = this.placement.readings;
		if (strayAts.size === 0) return [];
		const listed = this.listed(
			[...strayAts],
			([resource, { text, closestKey, notLast }]) => {
				const hint = notLast
					? `"@${text}" must end the name, or be followed only by a variant`
					: `did you mean "@${closestKey}"?`;
				return `${resource} (${hint})`;
			}
		);
		const count = strayAts.size === 1 ? "name has" : "names have";
		return [
			warningDiagnostic(
				"route.strayAt",
				{ resource: this.config.file },
				[
					`${strayAts.size} ${count} an "@" that routes nowhere, so ${strayAts.size === 1 ? "it is read as an ordinary name" : "they are read as ordinary names"}:`,
					...listed,
				].join("\n")
			),
		];
	}

	/** A dot part one edit from a declared variant is probably that variant, mistyped. */
	private variantTypo(): Diagnostic[] {
		const { variantTypos } = this.placement.readings;
		if (variantTypos.size === 0) return [];
		const listed = this.listed(
			[...variantTypos],
			([resource, { text, variant }]) =>
				`${resource} (did you mean ".${variant}" for ".${text}"?)`
		);
		const many = variantTypos.size > 1;
		return [
			warningDiagnostic(
				"variant.typo",
				{ resource: this.config.file },
				[
					`${variantTypos.size} ${many ? "names end" : "name ends"} in a dot part that is one edit from a declared variant, so ${many ? "they are read as ordinary names" : "it is read as an ordinary name"}:`,
					...listed,
				].join("\n")
			),
		];
	}

	private unrouted(): Diagnostic[] {
		return this.diagnosePaths(
			this.placement.leftOut.withStatus("unrouted"),
			(resource) =>
				warningDiagnostic(
					"route.unrouted",
					{ resource },
					'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
				)
		);
	}

	/** The files a server route names but a replicating one governs, with the server routes ignored. */
	private shipped(): { file: RoutedFile; ignored: string[] }[] {
		const { routes } = this.config;
		return this.placement.files.flatMap((file) => {
			const ignored = [...new Set(file.ignoredRoutes)].filter((key) => {
				const service = routes.get(key)?.service;
				return service !== undefined && isServerOnlyService(service);
			});
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

	/** An `@` an outer route outranks does nothing, once per file or folder that spells it; the files it ships to clients are reported as such instead. */
	private ignoredAt(): Diagnostic[] {
		const shipped = new Set(
			this.shipped().map(({ file }) => file.entry.source)
		);
		const ignored = new Map<
			string,
			{ key: string; route: string; kind: string; name?: string }
		>();
		for (const file of this.placement.files) {
			if (shipped.has(file.entry.source)) continue;
			for (const { key, dir } of file.ignoredAts) {
				const { route } = file;
				if (dir === undefined)
					ignored.set(file.entry.source, {
						key,
						route,
						kind: "file",
						name: file.init ? undefined : file.instancePath.at(-1),
					});
				else
					ignored.set(joinPosix(file.entry.rootDir, dir), {
						key,
						route,
						kind: "folder",
						name: file.folderNodes
							.find((node) => node.dir === dir)
							?.instancePath.at(-1),
					});
			}
		}
		return this.diagnosePaths(
			[...ignored].sort(([a], [b]) => compareStrings(a, b)),
			(resource, { key, route, kind, name }) =>
				warningDiagnostic(
					"route.ignoredAt",
					{ resource },
					`"@${key}" does nothing here, because the "${route}" route already governs this ${kind}${name === undefined ? "" : `, so it stays in the name (${name})`}. Remove it, or move the ${kind} out of the "${route}" route's files.`
				)
		);
	}

	/** A route that an outer route outranks is ignored, which sends a server route's modules to clients when the outer one replicates. */
	private serverCodeShipped(): Diagnostic[] {
		const shipped = this.shipped();
		if (shipped.length === 0) return [];

		const quoted = (keys: Iterable<string>) =>
			joinedWithAnd([...new Set(keys)].map((key) => `"${key}"`));
		const ignoredKeys = quoted(shipped.flatMap(({ ignored }) => ignored));
		const governing = quoted(shipped.map(({ file }) => file.route));
		const listed = this.listed(
			shipped,
			({ file }) =>
				`${file.entry.source} -> ${instanceKey(file.instancePath)}`
		);
		const many = shipped.length > 1;
		return [
			warningDiagnostic(
				"route.serverCodeShipped",
				{ resource: this.config.file },
				[
					`${shipped.length} ${many ? "files" : "file"} under a ${ignoredKeys} route ${many ? "ship" : "ships"} to clients, because ${governing} ${governing.includes(" and ") ? "govern" : "governs"} ${many ? "them" : "it"}:`,
					...listed,
					`Move ${many ? "them" : "it"} out of the ${governing} route's files if ${many ? "they're" : "it's"} server code.`,
				].join("\n")
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

		const listed = this.listed(
			dead,
			({ file, run }) =>
				`${file.entry.source} -> ${instanceKey(file.instancePath)} (${BuildValidator.describeRun(run)}, placed by the "${file.route}" route)`
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
				].join("\n")
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

	/** One warning per file, though a copied init script is routed more than once. */
	private buriedScriptSuffix(): Diagnostic[] {
		const { routed, leftOut } = this.placement;
		const buried = new Map<string, RojoScriptSuffix>();
		for (const { entry, buriedScriptSuffix } of routed)
			if (
				buriedScriptSuffix &&
				leftOut.get(entry.source)?.status !== "pruned"
			)
				buried.set(entry.source, buriedScriptSuffix);
		return [...buried].map(([source, suffix]) =>
			warningDiagnostic(
				"variant.buriedScriptSuffix",
				{ resource: source },
				`".${suffix}" isn't this file's last suffix, so Rojo will make it a ModuleScript. Put it last, as in Foo.mock.${suffix}.luau.`
			)
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
		return this.diagnosePaths(metas, (resource, folder) =>
			warningDiagnostic(
				"meta.appliesToNothing",
				{ resource },
				`applies to nothing, because ${folder} never becomes an instance. Move the meta into the folder that should get it.`
			)
		);
	}

	/** The first few items as indented lines, then how many more went unlisted. */
	private listed<T>(
		items: readonly T[],
		line: (item: T) => string
	): string[] {
		const lines = items
			.slice(0, DIAGNOSED_PATHS)
			.map((item) => `  ${line(item)}`);
		const unlisted = items.length - lines.length;
		return unlisted > 0
			? [...lines, `  ${unlisted} more like it aren't listed.`]
			: lines;
	}

	/** One diagnostic per path, up to a cap; the last one says how many more went unlisted. */
	private diagnosePaths<T>(
		paths: readonly (readonly [string, T])[],
		diagnose: (path: string, item: T) => Diagnostic
	): Diagnostic[] {
		const diagnosed = paths
			.slice(0, DIAGNOSED_PATHS)
			.map(([path, item]) => diagnose(path, item));
		const unlisted = paths.length - diagnosed.length;
		if (unlisted === 0) return diagnosed;
		const last = diagnosed[diagnosed.length - 1];
		return [
			...diagnosed.slice(0, -1),
			{
				...last,
				message: `${last.message} ${unlisted} more like it ${unlisted === 1 ? "isn't" : "aren't"} listed.`,
			},
		];
	}
}
