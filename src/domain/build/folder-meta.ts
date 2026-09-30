import { compareStrings, groupBy } from "../../base/collection.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { joinPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { RojoNode, RojoProject, instanceKey } from "../rojo/rojo-project.js";
import { Placement } from "./placement.js";
import { RoutedFile } from "./routing.js";

export interface FolderMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;
}

/** An `init.meta.json`: the fields it sets on the instance its folder becomes. */
export class FolderMeta implements FolderMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;

	constructor(
		readonly file: string,
		readonly rootDir: string,
		/** The folder, relative to the root dir; the root dir itself is "". */
		readonly dir: string,
		fields: FolderMetaFields
	) {
		this.className = fields.className;
		this.properties = fields.properties;
		this.attributes = fields.attributes;
		this.ignoreUnknownInstances = fields.ignoreUnknownInstances;
		this.id = fields.id;
	}

	/** The folder as an absolute POSIX path. */
	get folder(): string {
		return joinPosix(this.rootDir, this.dir);
	}

	/** Mirrors Rojo's precedence of a project's fields over a folder's meta. */
	fieldsUnder(templateNode: RojoNode): Partial<RojoNode> {
		const fields: Partial<RojoNode> = {};
		if (
			this.className !== undefined &&
			templateNode.$className === undefined
		)
			fields.$className = this.className;
		if (this.properties !== undefined)
			fields.$properties = {
				...this.properties,
				...templateNode.$properties,
			};
		if (
			this.attributes !== undefined &&
			templateNode.$attributes === undefined
		)
			fields.$attributes = { ...this.attributes };
		if (
			this.ignoreUnknownInstances !== undefined &&
			templateNode.$ignoreUnknownInstances === undefined
		)
			fields.$ignoreUnknownInstances = this.ignoreUnknownInstances;
		if (this.id !== undefined && templateNode.$id === undefined)
			fields.$id = this.id;
		return fields;
	}
}

/** Reads the fields of one meta file. */
export class FolderMetaParser {
	private static readonly FIELD_KINDS: Record<
		keyof FolderMetaFields,
		JsoncNode["kind"]
	> = {
		className: "string",
		properties: "object",
		attributes: "object",
		ignoreUnknownInstances: "boolean",
		id: "string",
	};

	private static readonly KIND_NAMES: Record<JsoncNode["kind"], string> = {
		object: "an object",
		array: "an array",
		string: "a string",
		number: "a number",
		boolean: "a boolean",
		null: "null",
	};

	constructor(private readonly file: string) {}

	parse(text: string): Result<FolderMetaFields, Diagnostic[]> {
		const problems = new DiagnosticCollector();
		const { root, value, errors } = parseJsonc(text);
		for (const { message, line, column } of errors) {
			problems.error(
				"meta.invalidSyntax",
				{ resource: this.file, position: { line, column } },
				`invalid JSONC: ${message}.`
			);
		}
		if (problems.hasErrors) return err([...problems.diagnostics]);

		if (root?.kind !== "object") {
			return err([
				errorDiagnostic(
					"meta.notAnObject",
					{ resource: this.file, position: { line: 1, column: 1 } },
					"a meta file must be a JSON object."
				),
			]);
		}

		// Rojo ignores fields it doesn't know, such as `$schema`.
		for (const property of root.properties) {
			if (!Object.hasOwn(FolderMetaParser.FIELD_KINDS, property.name))
				continue;
			const expected =
				FolderMetaParser.FIELD_KINDS[
					property.name as keyof FolderMetaFields
				];
			if (property.value.kind === expected) continue;
			problems.error(
				"meta.wrongType",
				{
					resource: this.file,
					position: {
						line: property.value.line,
						column: property.value.column,
					},
				},
				`"${property.name}": expected ${FolderMetaParser.KIND_NAMES[expected]}, found ${FolderMetaParser.KIND_NAMES[property.value.kind]}.`
			);
		}
		if (problems.hasErrors) return err([...problems.diagnostics]);

		const fields = value as Record<string, unknown>;
		return ok(
			Object.fromEntries(
				Object.keys(FolderMetaParser.FIELD_KINDS)
					.filter((key) => fields[key] !== undefined)
					.map((key) => [key, fields[key]])
			) as FolderMetaFields
		);
	}
}

type Copy = Extract<FolderMetaOutcome, { kind: "copied" }>;

/** The directories written as one `$path`, whose content Rojo reads itself. */
export interface CollapsedDirs {
	/** Whether `path` is a collapsed directory, or lies inside one. */
	covers(path: string): boolean;
}

/** What became of the folder meta that reaches one node Rojo wouldn't apply it to. */
export type FolderMetaOutcome =
	| {
			readonly kind: "copied";
			readonly instancePath: readonly string[];
			readonly meta: FolderMeta;
			readonly templateNode: RojoNode;
	  }
	/** A file is what Rojo reads at the node, so every meta reaching it applies to nothing. */
	| {
			readonly kind: "shared";
			readonly instance: string;
			readonly metas: readonly FolderMeta[];
			readonly file: RoutedFile;
	  }
	| {
			readonly kind: "templatePath";
			readonly instance: string;
			readonly meta: FolderMeta;
	  };

interface ReachedNode {
	readonly instancePath: readonly string[];
	/** The folders that name the node, as absolute POSIX paths. */
	readonly dirs: Set<string>;
}

/** Copies each folder's meta onto the nodes it names that Rojo wouldn't apply it to; the last root dir wins, and the template beats both. */
export class FolderMetaApplier {
	private readonly metaByDir: ReadonlyMap<string, FolderMeta>;

	constructor(
		private readonly placement: Placement,
		private readonly collapsed: CollapsedDirs,
		folderMeta: readonly FolderMeta[]
	) {
		this.metaByDir = new Map(folderMeta.map((meta) => [meta.folder, meta]));
	}

	/** Edits `project`, and reports what each meta came to. Fails when two metas from one root dir reach one node, or a ref would repeat. */
	apply(project: RojoProject): Result<FolderMetaOutcome[], Diagnostic[]> {
		const problems = new DiagnosticCollector();
		const outcomes = this.decide(project, problems);
		this.checkIds(outcomes, problems);
		if (problems.hasErrors) return err([...problems.diagnostics]);

		for (const { instancePath, meta, templateNode } of this.copies(
			outcomes
		))
			project.insertNode(instancePath, meta.fieldsUnder(templateNode));
		return ok(outcomes);
	}

	/** One outcome per node the folders of the placed and displaced files reach with some meta. */
	private decide(
		project: RojoProject,
		problems: DiagnosticCollector
	): FolderMetaOutcome[] {
		const { config, template, files, routed, leftOut } = this.placement;
		const sharedWithFile = new Map(
			files.map((file) => [instanceKey(file.instancePath), file])
		);
		const displaced = routed.filter(
			(file) => leftOut.get(file.entry.source)?.status === "displaced"
		);

		const outcomes: FolderMetaOutcome[] = [];
		const reportedClashes = new Set<string>();
		for (const [instance, node] of this.reachedNodes([
			...files,
			...displaced,
		])) {
			const metas = [...node.dirs]
				.filter((dir) => !this.collapsed.covers(dir))
				.flatMap((dir) => this.metaByDir.get(dir) ?? [])
				.sort(
					(a, b) =>
						config.rootDirs.indexOf(a.rootDir) -
						config.rootDirs.indexOf(b.rootDir)
				);
			if (metas.length === 0) continue;

			for (const clash of this.sameRootClashes(metas)) {
				const key = clash.map(({ file }) => file).join("\0");
				if (reportedClashes.has(key)) continue;
				reportedClashes.add(key);
				problems.error(
					"meta.sameNode",
					{ resource: clash[0].file },
					`${clash.map(({ file }) => file).join(" and ")} both apply to "${instance}" from one root dir, and neither ranks above the other. Keep one of them.`
				);
			}

			const shared = sharedWithFile.get(instance);
			if (shared) {
				outcomes.push({
					kind: "shared",
					instance,
					metas,
					file: shared,
				});
				continue;
			}

			const meta = metas[metas.length - 1];
			const templateNode = template.getNode(node.instancePath);
			if (templateNode?.$path !== undefined)
				outcomes.push({ kind: "templatePath", instance, meta });
			else if (project.getNode(node.instancePath))
				outcomes.push({
					kind: "copied",
					instancePath: node.instancePath,
					meta,
					templateNode: templateNode ?? {},
				});
		}
		return outcomes;
	}

	private copies(outcomes: readonly FolderMetaOutcome[]): Copy[] {
		return outcomes.filter(
			(outcome): outcome is Copy => outcome.kind === "copied"
		);
	}

	/** A ref must be unique, so one meta's id can't be copied onto several instances. */
	private checkIds(
		outcomes: readonly FolderMetaOutcome[],
		problems: DiagnosticCollector
	): void {
		const withId = groupBy(
			this.copies(outcomes).filter(
				({ meta, templateNode }) =>
					meta.id !== undefined && templateNode.$id === undefined
			),
			({ meta }) => meta,
			({ instancePath }) => instanceKey(instancePath)
		);
		for (const [meta, instances] of withId)
			if (instances.length > 1)
				problems.error(
					"meta.idOnSeveralNodes",
					{ resource: meta.file },
					`id "${meta.id}" would be copied onto ${instances.length} instances (${instances.join(", ")}), but a ref must be unique. Remove the id, or keep the folder's files in one service.`
				);
	}

	private reachedNodes(
		files: readonly RoutedFile[]
	): Map<string, ReachedNode> {
		const reached = new Map<string, ReachedNode>();
		for (const { entry, folderNodes } of files) {
			for (const { instancePath, dir } of folderNodes) {
				const key = instanceKey(instancePath);
				const node = reached.get(key) ?? {
					instancePath,
					dirs: new Set(),
				};
				node.dirs.add(joinPosix(entry.rootDir, dir));
				reached.set(key, node);
			}
		}
		return reached;
	}

	/** Each group of metas from one root dir that reach the same node. */
	private sameRootClashes(metas: readonly FolderMeta[]): FolderMeta[][] {
		return [...groupBy(metas, ({ rootDir }) => rootDir).values()]
			.filter((group) => group.length > 1)
			.map((group) =>
				group.sort((a, b) => compareStrings(a.file, b.file))
			);
	}
}
