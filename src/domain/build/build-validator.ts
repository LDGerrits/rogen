import path from "path";
import { compareStrings } from "../../base/collection.js";
import { joinPosix, toPosix } from "../../base/path.js";
import { capitalized, listLimited } from "../../base/string.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DeclaredKeys, ResolvedConfig } from "../config/config.js";
import { RojoFile } from "../rojo/rojo-file.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { FolderMeta } from "./folder-meta.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./routing.js";
import { Assembly } from "./tree-assembler.js";

type InstancelessFolder =
	"root dir" | "routing folder" | "tag folder" | "invisible folder";

const LISTED_PATHS = 3;
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
			...this.capitalSuffix(),
			...this.unrouted(),
			...this.dormantCapitalSuffix(),
			...this.buriedScriptSuffix(),
			...this.untaggedClash(),
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
		const unclaimed = this.placement
			.unclaimedMeta()
			.map(({ path, hint }) => (hint ? `${path} (${hint})` : path));
		if (unclaimed.length === 0) return [];
		const one = unclaimed.length === 1;
		return [
			warningDiagnostic(
				"meta.unclaimed",
				{ resource: this.config.outFile },
				`${unclaimed.length} meta ${one ? "file belongs" : "files belong"} to no file, so Rojo ignores ${one ? "it" : "them"} (${listLimited(unclaimed, LISTED_PATHS)}). A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin.`
			),
		];
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

	/** A capital suffix routes a file whose name may only happen to end in a route key. */
	private capitalSuffix(): Diagnostic[] {
		const routedBySuffix = this.placement.routed
			.filter(({ separatorName }) => separatorName)
			.map((file): [string, RoutedFile] => [file.entry.source, file]);
		const shared = [...this.config.keys.routeKeys].find(
			(key) => key.toLowerCase() === "shared"
		);
		const keep = shared
			? `${shared}/ or mark its folder .${shared}`
			: "another routing folder";
		return this.diagnosePaths(routedBySuffix, (resource, file) => {
			return warningDiagnostic(
				"route.capitalSuffix",
				{ resource },
				`routed to "${file.route}" by its capital suffix, so it becomes ${instanceKey(file.instancePath)}. To route it on purpose, name it ${file.separatorName}; to keep its name, put it under ${keep}.`
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

	/** A capital suffix pruned a file whose name may only happen to end in a tag. */
	private dormantCapitalSuffix(): Diagnostic[] {
		const byTag = new Map<string, Map<string, string>>();
		for (const [source, why] of this.placement.leftOut.withStatus(
			"pruned"
		)) {
			for (const { tag, separatorName } of why.tags)
				if (separatorName)
					byTag.set(
						tag,
						(byTag.get(tag) ?? new Map()).set(source, separatorName)
					);
		}
		return [...byTag].flatMap(([tag, separatorNames]) =>
			this.diagnosePaths([...separatorNames], (resource, separatorName) =>
				warningDiagnostic(
					"tag.dormantCapitalSuffix",
					{ resource },
					`pruned because its capital suffix matches the dormant tag "${tag}". If it's a variant, name it ${separatorName}; if not, rename it so it doesn't end in "${capitalized(tag)}".`
				)
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
	private untaggedClash(): Diagnostic[] {
		return this.placement.clashes
			.filter(({ claimants }) =>
				claimants.every((file) => file.tags.length === 0)
			)
			.map(({ instance, claimants }) =>
				warningDiagnostic(
					"tag.untaggedClash",
					{ resource: this.config.outFile },
					`${claimants.length} files all become "${instance}" (${claimants.map(({ entry }) => entry.source).join(", ")}), so only the last one is used.`
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

	/** One warning per template node and the file or folder it displaced. */
	private templateClash(): Diagnostic[] {
		const { routed, leftOut } = this.placement;
		const clashes = new Map<string, { instance: string; source: string }>();
		for (const file of routed) {
			const why = leftOut.get(file.entry.source);
			if (why?.status !== "displaced") continue;
			const instance = instanceKey(why.node);
			const source = this.namingSource(file, why.node);
			clashes.set(`${instance}\0${source}`, { instance, source });
		}
		return [...clashes.values()].map(({ instance, source }) =>
			warningDiagnostic(
				"tree.templateClash",
				{ resource: this.config.outFile },
				`"${instance}" is defined by both the template and ${source}, so the template's is kept and ${source} is left out. Rename one of them to keep both.`
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
					{ resource: this.config.outFile },
					`the template makes "${instanceKey(instancePath)}" a ${templateNode.$className}, but ${meta.file} makes it a ${meta.className}, so the template's class is kept.`
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
			if (dir === "") return "root dir";
			const folder = readings.folders.get(joinPosix(rootDir, dir));
			if (folder?.kind === "route") return "routing folder";
			if (folder?.kind === "tag") return "tag folder";
			return folder?.invisible ? "invisible folder" : undefined;
		};
		const metas = this.assembly.folderMeta.flatMap((meta) => {
			const kind = instanceless(meta);
			return kind ? [`${toPosix(meta.file)} (${kind})`] : [];
		});
		if (metas.length === 0) return [];
		const one = metas.length === 1;
		return [
			warningDiagnostic(
				"meta.appliesToNothing",
				{ resource: this.config.outFile },
				`${metas.length} init.meta.json ${one ? "file applies" : "files apply"} to nothing, because ${one ? "its folder never becomes" : "their folders never become"} an instance (${listLimited(metas, LISTED_PATHS)}). Move the meta into the folder that should get it.`
			),
		];
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
