import path from "path";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { DEFAULT_CONFIG_FILE, DEFAULT_PROJECT_FILE } from "../config/config.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { PlannedCommand, PlannedScaffold } from "./init-service.js";
import {
	CodePlan,
	ProjectCode,
	ProjectWrites,
	SetupProject,
} from "./project-code.js";
import { SampleGame } from "./sample-game.js";
import { StartingPlaces } from "./starter-places.js";
import { ProjectTree } from "./tree-plan.js";

export interface StarterScaffold {
	readonly tool: PlannedScaffold;
	readonly after: readonly PlannedCommand[];
}

export class NewStarter implements SetupProject {
	readonly kind = "place";
	readonly takesRoutes = true;
	readonly mountedFolders: readonly string[] = [];

	constructor(
		readonly code: ProjectCode,
		readonly writes: ProjectWrites,
		readonly places: StartingPlaces | undefined,
		readonly game: SampleGame | undefined,
		readonly scaffold: StarterScaffold | undefined
	) {}

	static serveCommand(places: StartingPlaces | undefined): string {
		return places ? `rogen serve ${places.place}` : "rogen serve";
	}

	get tree(): ProjectTree {
		return { kind: "new", ...(this.game && { game: this.game }) };
	}

	get name(): string | undefined {
		return this.places?.place;
	}

	get configFile(): string {
		return this.places?.configFile ?? DEFAULT_CONFIG_FILE;
	}

	get projectFile(): string {
		return this.places?.projectFile ?? DEFAULT_PROJECT_FILE;
	}

	get outputPrefix(): string {
		return this.places?.outputPrefix ?? "";
	}

	summarise(builder: InitPlanBuilder, shown: ReadonlySet<string>): void {
		const project = [
			...(shown.has("places")
				? []
				: [this.places ? "several places" : "one place"]),
			...(shown.has("language") ? [] : [this.code.language.copy.label]),
		];
		if (project.length > 0)
			builder.addSummary("Project", project.join(", "));
		if (this.game && !shown.has("sample"))
			builder.addSummary("Sample", "Greeter");
	}

	plan(builder: InitPlanBuilder, code: CodePlan): void {
		const { places, scaffold } = this;
		for (const note of places?.notes ?? []) builder.addNote(note);
		if (scaffold) {
			builder.setScaffold(scaffold.tool);
			for (const command of scaffold.after) builder.addCommand(command);
		}
		for (const note of code.notes) builder.addNote(note);
		if (!places && code.othersNote) builder.addNote(code.othersNote);
		if (scaffold)
			builder.addNote(
				`Starts from create-roblox-ts, which writes package.json${places ? "" : ", tsconfig.json"} and the compiler's settings.`
			);
		if (code.compilerNote) builder.addNote(code.compilerNote);
		if (this.game) builder.addNote(this.sampleNote(builder));
		this.planNextSteps(builder, code);
	}

	private sampleNote(builder: InitPlanBuilder): string {
		const { places } = this;
		const here = (...parts: string[]) =>
			builder.fromHere(path.posix.join(...parts));
		const configFile = here(this.configFile);
		return places
			? `Greeter sample in ${here(places.commonSourcePath)}, Welcome in ${here(places.placeSourcePath)}, Rojo's Baseplate in ${configFile}.`
			: `Greeter sample in ${here(this.code.sourcePaths[0], "greeter")}, Rojo's Baseplate in ${configFile}.`;
	}

	private planNextSteps(builder: InitPlanBuilder, code: CodePlan): void {
		const { places, writes } = this;
		const { compiler } = this.code.language;
		builder.addEdit(...code.edits);
		if (writes.projectFilesHint) builder.addEdit(writes.projectFilesHint);
		const wroteReadme = writes.files.some(
			({ fileName }) => fileName === "README.md"
		);
		builder.addEdit(
			wroteReadme
				? `See README.md for ${places ? "routes, the tree and adding a place" : "routes and the tree"}.`
				: `${code.configEdit} Routes and the tree: ${DOCS_URL}/${places ? "multi-place" : "routing"}`
		);
		builder.addRun(
			...(compiler ? [compiler.compileCommand] : []),
			NewStarter.serveCommand(places)
		);
	}
}
