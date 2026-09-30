import path from "path";
import { compareStrings } from "../../base/collection.js";
import { ancestors, joinPosix, stemOf, toPosix } from "../../base/path.js";
import { capitalized } from "../../base/string.js";
import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileSystemService,
	FileType,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import {
	INIT_META_FILE,
	META_FILE_SUFFIX,
	classifyFile,
	rojoDataName,
	rojoMetaFile,
	rojoMetaName,
} from "../rojo/rojo-files.js";
import { instanceKey } from "../rojo/rojo-project.js";
import { MetaReplacement } from "../toolchain/toolchain.js";
import {
	AssembledBuild,
	FolderMeta,
	PlacedBuild,
	RoutedFile,
	ScannedRoot,
} from "./build-record.js";
import { withFirstLetterFlipped } from "./declared-keys.js";
import {
	SyncedLayout,
	emittedPath,
	isSynced,
	relativeToProject,
} from "./sync-layout.js";

type BuildRule = (build: AssembledBuild) => Diagnostic[];

/** In the order their warnings are reported. */
const RULES: readonly BuildRule[] = [
	missingRootDir,
	unresolvedLink,
	unclaimedMeta,
	caseMismatch,
	capitalSuffix,
	unrouted,
	dormantCapitalSuffix,
	buriedScriptSuffix,
	untaggedClash,
	runContextTarget,
	templateClash,
	metaNotCopied,
	templateClass,
	metaAppliesToNothing,
];

const LISTED_PATHS = 3;
const DIAGNOSED_PATHS = 10;

const PLAYER_SCRIPT_CONTAINERS = new Set([
	"StarterPlayerScripts",
	"StarterCharacterScripts",
]);

/** Reports on a finished build and decides nothing. */
export class BuildValidator {
	constructor(private readonly fileSystemService: FileSystemService) {}

	check(build: AssembledBuild): Diagnostic[] {
		return RULES.flatMap((rule) => rule(build));
	}

	/** Reports on what the sync dir holds, which only changes when the compiler runs. */
	async checkSyncDir(build: PlacedBuild): Promise<Diagnostic[]> {
		return [
			...(await this.nothingEmitted(build)),
			...(await this.metaNotSynced(build)),
		];
	}

	/** Warns once per root dir whose top-level entries have no emitted counterpart under `syncDir`. */
	private async nothingEmitted({
		config,
		layout,
	}: PlacedBuild): Promise<Diagnostic[]> {
		if (!isSynced(layout)) return [];
		const { syncDir, projectDir, commonRoot } = layout;

		const shown = (target: string) =>
			relativeToProject(target, projectDir) || ".";
		const warnings: Diagnostic[] = [];

		for (const rootDir of config.rootDirs) {
			const emitted = await this.topLevelEmitted(rootDir, layout);
			if (emitted.length === 0 || (await this.anyExists(emitted)))
				continue;

			const expected = path.join(
				syncDir,
				path.relative(commonRoot, rootDir)
			);
			const found = await this.findShifted(syncDir, emitted[0]);
			const nearest = found
				? `Found "${shown(found)}" — is the compiler's output rooted differently?`
				: `The nearest path that exists is "${shown(await this.nearestExisting(expected))}" — has the compiler run?`;
			warnings.push(
				warningDiagnostic(
					"output.nothingEmitted",
					{ resource: rootDir },
					`nothing emitted for root dir "${shown(rootDir)}" exists under "${shown(expected)}". ${nearest}`
				)
			);
		}
		return warnings;
	}

	/** Warns once for claimed meta with no copy under `syncDir`, skipping root dirs `nothingEmitted` reports. */
	private async metaNotSynced({
		config,
		index,
		layout,
		roots,
	}: PlacedBuild): Promise<Diagnostic[]> {
		if (!isSynced(layout)) return [];
		const { syncDir, projectDir } = layout;
		const unclaimed = new Set(
			findUnclaimedMeta(index, roots).map(({ path }) => path)
		);
		const replacements = layout.tools.flatMap(
			({ metaReplacement }) => metaReplacement ?? []
		);

		const missing: string[] = [];
		let converted = 0;
		let conversion: MetaReplacement | undefined;

		for (const root of roots) {
			if (!(await this.hasSyncedOutput(root.rootDir, layout))) continue;
			for (const metaFile of root.metaFiles) {
				const source = path.join(root.rootDir, metaFile);
				if (unclaimed.has(toPosix(source))) continue;
				const emitted = emittedPath(source, layout);
				if (await this.fileSystemService.exists(emitted)) continue;
				missing.push(toPosix(source));
				const stem = emitted.slice(0, -META_FILE_SUFFIX.length);
				for (const replacement of replacements)
					if (
						await this.fileSystemService.exists(
							`${stem}${replacement.suffix}`
						)
					) {
						conversion ??= replacement;
						if (replacement === conversion) converted++;
						break;
					}
			}
		}
		if (missing.length === 0) return [];

		const them = missing.length === 1 ? "it" : "them";
		const cause = conversion
			? `The processor turned ${converted === missing.length ? them : `${converted} of them`} into ${conversion.suffix}, which Rojo syncs as a ModuleScript instead of applying. ${conversion.note}`
			: "Have the compiler copy .meta.json files into its output.";
		return [
			warningDiagnostic(
				"output.metaNotSynced",
				{ resource: config.outFile },
				`${missing.length} meta ${missing.length === 1 ? "file has" : "files have"} no copy under "${relativeToProject(syncDir, projectDir) || "."}" (${listPaths(missing)}), so Rojo doesn't apply ${them}. ${cause}`
			),
		];
	}

	/** Skips dot-files, which are mostly markers a compiler never emits. */
	private async topLevelEmitted(
		rootDir: string,
		layout: SyncedLayout
	): Promise<string[]> {
		if (!(await this.fileSystemService.isDirectory(rootDir))) return [];
		return (await this.fileSystemService.readDirectory(rootDir))
			.filter(([name]) => !name.startsWith("."))
			.map(([name]) => emittedPath(path.join(rootDir, name), layout));
	}

	private async anyExists(paths: readonly string[]): Promise<boolean> {
		for (const target of paths)
			if (await this.fileSystemService.exists(target)) return true;
		return false;
	}

	/** Whether any top-level entry of `rootDir` has its emitted counterpart under `syncDir`. */
	private async hasSyncedOutput(
		rootDir: string,
		layout: SyncedLayout
	): Promise<boolean> {
		return this.anyExists(await this.topLevelEmitted(rootDir, layout));
	}

	/** Looks for `emitted` one level up or down from where it was expected, the way a shifted common root moves it. */
	private async findShifted(
		syncDir: string,
		emitted: string
	): Promise<string | undefined> {
		const segments = path.relative(syncDir, emitted).split(path.sep);
		const candidates = segments
			.slice(1)
			.map((_, index) =>
				path.join(syncDir, ...segments.slice(index + 1))
			);

		if (await this.fileSystemService.isDirectory(syncDir)) {
			for (const [
				name,
				type,
			] of await this.fileSystemService.readDirectory(syncDir))
				if (isDirectoryType(type))
					candidates.push(path.join(syncDir, name, ...segments));
		}

		for (const candidate of candidates)
			if (await this.fileSystemService.exists(candidate))
				return candidate;
		return undefined;
	}

	private async nearestExisting(target: string): Promise<string> {
		const chain = [target, ...ancestors(target)];
		for (const dir of chain)
			if (await this.fileSystemService.exists(dir)) return dir;
		return chain[chain.length - 1];
	}
}

function missingRootDir({ roots }: AssembledBuild): Diagnostic[] {
	return roots
		.filter((root) => !root.exists)
		.map((root) =>
			warningDiagnostic(
				"scan.missingRootDir",
				{ resource: root.rootDir },
				"this root dir does not exist, so it contributes nothing."
			)
		);
}

function unresolvedLink({ leftOut }: AssembledBuild): Diagnostic[] {
	return [...leftOut]
		.filter(([, why]) => why.status === "skipped")
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

function unclaimedMeta({ config, index, roots }: AssembledBuild): Diagnostic[] {
	const unclaimed = findUnclaimedMeta(index, roots).map(({ path, hint }) =>
		hint ? `${path} (${hint})` : path
	);
	if (unclaimed.length === 0) return [];
	const one = unclaimed.length === 1;
	return [
		warningDiagnostic(
			"meta.unclaimed",
			{ resource: config.outFile },
			`${unclaimed.length} meta ${one ? "file belongs" : "files belong"} to no file, so Rojo ignores ${one ? "it" : "them"} (${listPaths(unclaimed)}). A file's meta is named after the name Rojo gives the file, without .server, .client or .plugin.`
		),
	];
}

/** A folder, marker or suffix that only differs from a declared key in letter case is read as an ordinary name. */
function caseMismatch({ keys, roots, readings }: AssembledBuild): Diagnostic[] {
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
			const read = readings.entries.get(entry.source);
			for (const folder of read?.folders ?? [])
				note(joinPosix(entry.rootDir, folder.dir), folder.nearMissKey);
			note(entry.source, read?.match.nearMissKey);
		}
	}

	return diagnosePaths([...nearMisses.keys()], (resource) => {
		const key = nearMisses.get(resource) as string;
		const kind = keys.tagKeys.has(key) ? "tag" : "route";
		return warningDiagnostic(
			"route.caseMismatch",
			{ resource },
			`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${withFirstLetterFlipped(key)}", or declare it as written.`
		);
	});
}

/** A capital suffix routes a file whose name may only happen to end in a route key. */
function capitalSuffix({ keys, routed }: AssembledBuild): Diagnostic[] {
	const bySource = new Map<string, RoutedFile>(
		routed
			.filter(({ separatorName }) => separatorName)
			.map((file) => [file.entry.source, file])
	);
	const shared = [...keys.routeKeys].find(
		(key) => key.toLowerCase() === "shared"
	);
	const keep = shared
		? `${shared}/ or mark its folder .${shared}`
		: "another routing folder";
	return diagnosePaths([...bySource.keys()], (resource) => {
		const file = bySource.get(resource) as RoutedFile;
		return warningDiagnostic(
			"route.capitalSuffix",
			{ resource },
			`routed to "${file.route}" by its capital suffix, so it becomes ${instanceKey(file.instancePath)}. To route it on purpose, name it ${file.separatorName}; to keep its name, put it under ${keep}.`
		);
	});
}

function unrouted({ leftOut }: AssembledBuild): Diagnostic[] {
	return diagnosePaths(
		[...leftOut]
			.filter(([, why]) => why.status === "unrouted")
			.map(([source]) => source),
		(resource) =>
			warningDiagnostic(
				"route.unrouted",
				{ resource },
				'matched no route, so it is left out. Add a "*" route, or move it into a routing folder.'
			)
	);
}

/** A capital suffix pruned a file whose name may only happen to end in a tag. */
function dormantCapitalSuffix({ leftOut }: AssembledBuild): Diagnostic[] {
	const byTag = new Map<string, Map<string, string>>();
	for (const [source, why] of leftOut) {
		if (why.status !== "pruned") continue;
		for (const { tag, separatorName } of why.tags)
			if (separatorName)
				byTag.set(
					tag,
					(byTag.get(tag) ?? new Map()).set(source, separatorName)
				);
	}
	return [...byTag].flatMap(([tag, separatorNames]) =>
		diagnosePaths([...separatorNames.keys()], (resource) =>
			warningDiagnostic(
				"tag.dormantCapitalSuffix",
				{ resource },
				`pruned because its capital suffix matches the dormant tag "${tag}". If it's a variant, name it ${separatorNames.get(resource)}; if not, rename it so it doesn't end in "${capitalized(tag)}".`
			)
		)
	);
}

function buriedScriptSuffix({ routed, leftOut }: AssembledBuild): Diagnostic[] {
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
function untaggedClash({ config, clashes }: AssembledBuild): Diagnostic[] {
	return clashes
		.filter(({ claimants }) =>
			claimants.every((file) => file.tags.length === 0)
		)
		.map(({ instance, claimants }) =>
			warningDiagnostic(
				"tag.untaggedClash",
				{ resource: config.outFile },
				`${claimants.length} files all become "${instance}" (${claimants.map(({ entry }) => entry.source).join(", ")}), so only the last one is used.`
			)
		);
}

/** Rojo can't give scripts a run context there, so they'd never run. */
function runContextTarget({ config, targets }: AssembledBuild): Diagnostic[] {
	if (config.template?.project.emitLegacyScripts !== false) return [];
	const routes = [...targets]
		.filter(
			([, { service, folders }]) =>
				service === "StarterPlayer" &&
				PLAYER_SCRIPT_CONTAINERS.has(folders[0])
		)
		.map(([key]) => `"${key}" → ${config.routes[key]}`);
	return routes.length > 0
		? [
				warningDiagnostic(
					"tree.runContextTarget",
					{ resource: config.outFile },
					`emitLegacyScripts: false in the template isn't supported with routes that target StarterPlayerScripts or StarterCharacterScripts (${routes.join(", ")}). Route ${routes.length === 1 ? "it" : "them"} to another service, or remove emitLegacyScripts from the template.`
				),
			]
		: [];
}

/** One warning per template node and the file or folder it displaced. */
function templateClash({
	config,
	routed,
	leftOut,
}: AssembledBuild): Diagnostic[] {
	const clashes = new Map<string, { instance: string; source: string }>();
	for (const file of routed) {
		const why = leftOut.get(file.entry.source);
		if (why?.status !== "displaced") continue;
		const instance = instanceKey(why.node);
		const source = namingSource(file, why.node);
		clashes.set(`${instance}\0${source}`, { instance, source });
	}
	return [...clashes.values()].map(({ instance, source }) =>
		warningDiagnostic(
			"tree.templateClash",
			{ resource: config.outFile },
			`"${instance}" is defined by both the template and ${source}, so the template's is kept and ${source} is left out. Rename one of them to keep both.`
		)
	);
}

/** The file itself, or the folder of the file that names the node. */
function namingSource(file: RoutedFile, node: readonly string[]): string {
	const folder = file.folderNodes.find(
		({ instancePath }) => instanceKey(instancePath) === instanceKey(node)
	);
	return folder
		? joinPosix(file.entry.rootDir, folder.dir)
		: file.entry.source;
}

/** Folder meta the build couldn't copy: a file is what Rojo reads at the node, or the template's `$path` is. */
function metaNotCopied({ metaOutcomes }: AssembledBuild): Diagnostic[] {
	return metaOutcomes.flatMap((outcome) => {
		if (outcome.kind === "shared")
			return outcome.metas.map((meta) =>
				sharedWithFile(meta, outcome.file, outcome.instance)
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

function sharedWithFile(
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
			`this folder shares "${instance}" with an init folder, which is what Rojo reads there, so its meta applies to nothing. Put it in ${joinPosix(entry.source, INIT_META_FILE)} instead.`
		);
	const fileName = path.posix.basename(entry.relativePath);
	const fix = rojoMetaFile(fileName) ?? `${fileName}.meta.json`;
	return warningDiagnostic(
		"meta.sharedWithScript",
		location,
		`this folder shares "${instance}" with ${fileName}, which is what Rojo reads there, so its meta applies to nothing. Put it in ${fix} beside the script, or turn the folder into an init folder.`
	);
}

function templateClass({ config, metaOutcomes }: AssembledBuild): Diagnostic[] {
	return metaOutcomes.flatMap((outcome) => {
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
				{ resource: config.outFile },
				`the template makes "${instanceKey(instancePath)}" a ${templateNode.$className}, but ${meta.file} makes it a ${meta.className}, so the template's class is kept.`
			),
		];
	});
}

type InstancelessFolder =
	"root dir" | "routing folder" | "tag folder" | "invisible folder";

/** Meta in folders that never become an instance, decided by the folder's name. */
function metaAppliesToNothing({
	config,
	folderMeta,
	readings,
}: AssembledBuild): Diagnostic[] {
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
	const metas = folderMeta.flatMap((meta) => {
		const kind = instanceless(meta);
		return kind ? [`${toPosix(meta.file)} (${kind})`] : [];
	});
	if (metas.length === 0) return [];
	const one = metas.length === 1;
	return [
		warningDiagnostic(
			"meta.appliesToNothing",
			{ resource: config.outFile },
			`${metas.length} init.meta.json ${one ? "file applies" : "files apply"} to nothing, because ${one ? "its folder never becomes" : "their folders never become"} an instance (${listPaths(metas)}). Move the meta into the folder that should get it.`
		),
	];
}

interface UnclaimedMeta {
	/** Absolute, POSIX-style. */
	readonly path: string;
	readonly hint?: string;
}

/** Meta no sibling on disk claims under Rojo's naming rule; pruned and excluded siblings still claim theirs. */
function findUnclaimedMeta(
	index: IndexReader,
	roots: readonly ScannedRoot[]
): UnclaimedMeta[] {
	return roots.flatMap((root) =>
		root.metaFiles.flatMap((metaFile) => {
			const fileName = path.posix.basename(metaFile);
			if (fileName === INIT_META_FILE) return [];
			const listing =
				index.getEntries(
					path.join(root.rootDir, path.posix.dirname(metaFile))
				) ?? new Map<string, FileType>();
			const siblings = [...listing]
				.filter(([, type]) => isFileType(type))
				.map(([sibling]) => sibling);
			const name = fileName.slice(0, -META_FILE_SUFFIX.length);
			if (siblings.some((file) => rojoMetaName(file) === name)) return [];

			const folder = listing.get(name);
			return [
				{
					path: joinPosix(root.rootDir, metaFile),
					hint: hintFor(
						name,
						siblings,
						folder !== undefined && isDirectoryType(folder)
					),
				},
			];
		})
	);
}

function hintFor(
	name: string,
	siblings: readonly string[],
	isFolder: boolean
): string | undefined {
	if (isFolder) return `a folder's meta is ${name}/init${META_FILE_SUFFIX}`;
	for (const file of siblings) {
		if (stemOf(file) !== name) continue;
		const metaName = rojoMetaName(file);
		if (metaName) return `Rojo reads ${metaName}${META_FILE_SUFFIX}`;
	}
	const withoutMeta = siblings.find(
		(file) =>
			rojoMetaName(file) === undefined &&
			classifyFile(file) !== undefined &&
			[stemOf(file), rojoDataName(file)].includes(name)
	);
	return withoutMeta ? `${withoutMeta} takes no meta` : undefined;
}

function listPaths(paths: readonly string[]): string {
	const listed = paths.slice(0, LISTED_PATHS).join(", ");
	return paths.length > LISTED_PATHS ? `${listed}, …` : listed;
}

/** One diagnostic per path, up to a cap; the last one says how many more went unlisted. */
function diagnosePaths(
	paths: readonly string[],
	diagnose: (path: string) => Diagnostic
): Diagnostic[] {
	const diagnosed = paths.slice(0, DIAGNOSED_PATHS).map(diagnose);
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
