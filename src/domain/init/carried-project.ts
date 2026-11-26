import { joinedBriefly, joinedWithAnd } from "../../base/strings.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { WrittenTree } from "../rojo/project-text.js";
import {
	DEFAULT_CONFIG_FILE,
	DEFAULT_PROJECT_FILE,
	configFileName,
} from "../config/config.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitKind } from "./init-service.js";
import { PROCESSED_OUTPUT } from "./output-configs.js";
import {
	CodePlan,
	LISTED_SHOWN,
	ProjectCode,
	ProjectWrites,
} from "./project-code.js";
import { ProjectTree } from "./tree-plan.js";

export type CarriedTree = Exclude<ProjectTree, { kind: "new" }>;

export interface ProcessedOutput {
	readonly folder: string;
	readonly config?: string;
}

export interface CarriedCode {
	readonly capturedKeys: readonly string[];
	readonly processed?: ProcessedOutput;
	readonly keptCode: readonly string[];
	readonly unmounted: readonly string[];
}

const BUILD_COMMANDS: Readonly<
	Record<Exclude<InitKind, "place">, (name: string) => string>
> = {
	model: (name) => `rogen build -o "${name}.rbxmx"`,
	plugin: (name) => `rogen build -p "${name}.rbxm"`,
};

export class CarriedProject {
	readonly name = undefined;
	readonly configFile = DEFAULT_CONFIG_FILE;
	readonly projectFile = DEFAULT_PROJECT_FILE;
	readonly outputPrefix = "";

	constructor(
		readonly kind: InitKind,
		readonly tree: CarriedTree,
		readonly code: ProjectCode,
		readonly writes: ProjectWrites,
		private readonly carried: CarriedCode
	) {}

	get takesRoutes(): boolean {
		return this.tree.kind !== "template" && this.tree.project.takesRoutes;
	}

	get mountedFolders(): readonly string[] {
		return this.tree.project.mountedFolders();
	}

	get capturedKeys(): readonly string[] {
		return this.carried.capturedKeys;
	}

	get unmounted(): readonly string[] {
		return this.carried.unmounted;
	}

	get written(): WrittenTree | undefined {
		return this.tree.kind === "lift"
			? this.tree.project.written
			: undefined;
	}

	get processedPath(): string | undefined {
		const { processed } = this.carried;
		return processed?.config ? processed.folder : undefined;
	}

	derivedRoutes(dirs: readonly string[]): DerivedRoutes | undefined {
		return this.tree.kind === "template"
			? undefined
			: DerivedRoutes.of(this.tree.project, dirs);
	}

	summarise(builder: InitPlanBuilder, shown: ReadonlySet<string>): void {
		const { kind, tree } = this;
		const project = [
			kind === "place" ? "one place" : `a ${kind}`,
			...(shown.has("language") ? [] : [this.code.language.copy.label]),
			...(tree.kind === "lift" ? [`lifting ${tree.from}`] : []),
		];
		builder.addSummary("Project", project.join(", "));
	}

	plan(builder: InitPlanBuilder, code: CodePlan): void {
		const { tree, writes } = this;
		const { processed, keptCode, unmounted } = this.carried;
		const { sourcePaths } = this.code;
		for (const file of writes.files) builder.addFile(file);
		if (!writes.skipGit) builder.requestGitInit();
		if (tree.kind === "lift") {
			builder.setLiftedFrom(tree.from);
			builder.setAction("lift");
		}
		for (const note of code.notes) builder.addNote(note);
		if (tree.kind === "lift" && processed)
			builder.addNote(
				CarriedProject.processedNote(tree.from, sourcePaths, processed)
			);
		if (keptCode.length > 0)
			builder.addNote(
				sourcePaths.length === 0
					? `Kept the mounts of ${joinedWithAnd(keptCode)} in the tree, since a folder with an init file is one instance.`
					: `Kept the mounts of ${joinedWithAnd(keptCode)} in the tree. To route their code, move the folders into ${sourcePaths[0]}.`
			);
		if (code.othersNote) builder.addNote(code.othersNote);
		if (tree.kind === "lift" && unmounted.length > 0) {
			const them = unmounted.length === 1 ? "it" : "them";
			builder.addNote(
				`Left out ${joinedBriefly(unmounted, LISTED_SHOWN)} with "globIgnorePaths", since Rojo ignored ${them}. To route ${them}, remove ${them} from "globIgnorePaths".`
			);
		}
		if (code.compilerNote) builder.addNote(code.compilerNote);
		this.planNextSteps(builder, code);
	}

	private planNextSteps(builder: InitPlanBuilder, code: CodePlan): void {
		const { tree, writes } = this;
		if (tree.kind === "template") {
			builder.addRun(BUILD_COMMANDS[tree.template](code.folderName));
			return;
		}
		builder.addEdit(...code.edits);
		if (writes.projectFilesHint) builder.addEdit(writes.projectFilesHint);
		if (tree.kind === "lift" && code.tracksProjectFile)
			builder.addEdit(
				`Rogen writes ${tree.from} now, so git can stop tracking it: git rm --cached ${tree.from}`
			);
		builder.addEdit(
			this.takesRoutes
				? `${code.configEdit} Routes and the tree: ${DOCS_URL}/routing`
				: code.configEdit
		);
		if (tree.kind === "lift" && !this.takesRoutes) {
			builder.addRun(
				BUILD_COMMANDS[this.kind === "plugin" ? "plugin" : "model"](
					tree.project.name ?? code.folderName
				)
			);
			return;
		}
		const { compiler } = this.code.language;
		builder.addRun(
			...(compiler ? [compiler.compileCommand] : []),
			this.processedPath
				? `rogen serve ${PROCESSED_OUTPUT}`
				: "rogen serve"
		);
	}

	private static processedNote(
		from: string,
		sourcePaths: readonly string[],
		{ folder, config }: ProcessedOutput
	): string {
		const source = joinedWithAnd(sourcePaths);
		return config
			? `Took ${folder} as Darklua's output, since ${config} is here. ${DEFAULT_CONFIG_FILE} reads ${source}, and ${configFileName(PROCESSED_OUTPUT)} reads ${folder}.`
			: `Kept the mounts of ${from} into ${folder}, which repeat ${source}, so Rojo syncs a script there twice. If a processor writes ${folder}, remove them and serve a copy of ${DEFAULT_CONFIG_FILE} with "compiledPath": "${folder}".`;
	}
}
