import path from "path";
import { compareStrings } from "../../base/collections.js";
import { joinPosix } from "../../base/path.js";
import { capitalized } from "../../base/strings.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { FolderMeta } from "./folder-meta.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./router.js";
import { Assembly } from "./tree-assembler.js";

type InstancelessFolder =
	"a root dir" | "a routing folder" | "a tag folder" | "an invisible folder";

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
			...this.unrouted(),
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

	/** A folder, marker or suffix that only differs from a declared key in letter case is read as an ordinary name. */
	private caseMismatch(): Diagnostic[] {
		const { roots, readings } = this.placement;
		const nearMisses = new Map<string, string>();
		const note = (resource: string, key: string | undefined) => {
			if (key && !nearMisses.has(resource)) nearMisses.set(resource, key);
		};

		for (const root of roots) {
			for (const marker of root.markers) {
				const resource = joinPosix(root.rootDir, marker);
				note(resource, readings.markers.get(resource)?.nearMissKey);
			}
			for (const entry of root.entries) {
				const read = readings.entryAt(entry.source);
				for (const folder of read.folders)
					note(
						joinPosix(entry.rootDir, folder.dir),
						folder.nearMissKey
					);
				note(entry.source, read.match.nearMissKey);
			}
		}

		return this.diagnosePaths([...nearMisses], (resource, key) => {
			const kind = this.config.keys.isTag(key) ? "tag" : "route";
			return warningDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${DeclaredKeys.flipFirstLetter(key)}", or declare it as written.`
			);
		});
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

	private buriedScriptSuffix(): Diagnostic[] {
		const { routed, leftOut } = this.placement;
		return routed.flatMap((file) =>
			file.buriedScriptSuffix &&
			leftOut.get(file.entry.source)?.status !== "pruned"
				? [
						warningDiagnostic(
							"tag.buriedScriptSuffix",
							{ resource: file.entry.source },
							`".${file.buriedScriptSuffix}" isn't this file's last suffix, so Rojo will make it a ModuleScript. Put it last, as in Foo.mock.${file.buriedScriptSuffix}.luau.`
						),
					]
				: []
		);
	}

	/** Only one untagged file can become an instance; a tagged one replacing it is the point of tags. */
	private instanceClash(): Diagnostic[] {
		return this.placement.clashes
			.filter(({ claimants }) =>
				claimants.every((file) => file.tags.length === 0)
			)
			.flatMap(({ instance, claimants }) => {
				const winner = claimants[claimants.length - 1].entry.source;
				return claimants
					.slice(0, -1)
					.map(({ entry }) =>
						warningDiagnostic(
							"tree.instanceClash",
							{ resource: entry.source },
							`becomes "${instance}", as ${winner} does, which takes its place. Rename one of them to keep both.`
						)
					);
			});
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
		const { routed, leftOut } = this.placement;
		const clashes = new Map<
			string,
			{ instance: string; kind: "file" | "folder" }
		>();
		for (const file of routed) {
			const why = leftOut.get(file.entry.source);
			if (why?.status !== "displaced") continue;
			const source = this.namingSource(file, why.node);
			clashes.set(source, {
				instance: instanceKey(why.node),
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

	/** The file itself, or the folder of the file that names the node. */
	private namingSource(file: RoutedFile, node: readonly string[]): string {
		const folder = file.folderNodes.find(
			({ instancePath }) =>
				instanceKey(instancePath) === instanceKey(node)
		);
		return folder
			? joinPosix(file.entry.rootDir, folder.dir)
			: file.entry.source;
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
		if (entry.kind === "init-folder")
			return warningDiagnostic(
				"meta.sharedWithScript",
				location,
				`this folder shares "${instance}" with an init folder, which is what Rojo reads there, so its meta applies to nothing. Put it in ${joinPosix(entry.source, RojoFile.INIT_META)} instead.`
			);
		const fileName = path.posix.basename(entry.relativePath);
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

	/** Meta in folders that never become an instance, decided by the folder's name. */
	private metaAppliesToNothing(): Diagnostic[] {
		const { readings } = this.placement;
		const instanceless = ({
			rootDir,
			dir,
		}: FolderMeta): InstancelessFolder | undefined => {
			if (dir === "") return "a root dir";
			const folder = readings.folders.get(joinPosix(rootDir, dir));
			if (folder?.kind === "route") return "a routing folder";
			if (folder?.kind === "tag") return "a tag folder";
			return folder?.invisible ? "an invisible folder" : undefined;
		};
		const metas = this.assembly.folderMeta.flatMap((meta) => {
			const kind = instanceless(meta);
			return kind ? [[meta.file, kind] as const] : [];
		});
		return this.diagnosePaths(metas, (resource, kind) =>
			warningDiagnostic(
				"meta.appliesToNothing",
				{ resource },
				`applies to nothing, because ${kind} never becomes an instance. Move the meta into the folder that should get it.`
			)
		);
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
