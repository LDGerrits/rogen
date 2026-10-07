import path from "path";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { configFileName } from "../config/config.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { PlaceChoices, PlacePlan } from "./place-plan.js";

/** A place extends `default.rogen.json` with its own root dir, syncing from its own subfolder when code is compiled or processed. */
export class PlaceSetup implements Setup<PlaceChoices> {
	constructor(
		private readonly directory: InitDirectory,
		/** The `default.rogen.json` the place joins, as it was read. */
		private readonly base: Result<BaseConfig, Diagnostic[]>,
		private readonly questions: InitQuestions
	) {}

	/** Asks for the name and folder of a place added beside an existing `default.rogen.json`. */
	async ask(): Promise<Result<PlaceChoices | undefined, Diagnostic[]>> {
		const { directory, base, questions } = this;
		const { workspace } = directory;
		if (base.isErr()) return err(base.error);

		const filesFor = (candidate: string) =>
			new ConfigSet(
				candidate,
				workspace.language,
				workspace.detectedDarklua
			).placeFiles;
		const given = directory.givenName;
		if (given) {
			const conflicts = directory.checkFree(filesFor(given));
			if (conflicts.length > 0) return err(conflicts);
		}
		const name =
			given ??
			(await questions.name(directory, {
				message: "Place name",
				description: "Writes <name>.rogen.json.",
				filesFor,
			}));
		if (name === undefined) return ok(undefined);

		const folder = await questions.placeFolder(directory, base.value, name);
		if (folder === undefined) return ok(undefined);
		// A run that can't ask takes the default folder unchecked.
		const problem = directory.placeFolderProblem(
			base.value.rootDirs,
			folder
		);
		if (problem) {
			return err([
				errorDiagnostic(
					"init.invalidPlaceFolder",
					{ resource: path.join(directory.path, folder) },
					problem
				),
			]);
		}

		return ok({
			name,
			folder,
			language: workspace.language,
			darklua: workspace.detectedDarklua,
			base: base.value,
		});
	}

	plan(choices: PlaceChoices, builder: InitPlanBuilder): void {
		const place = new PlacePlan(this.directory, choices);
		place.planFiles(builder);
		place.planSteps(builder);
		builder.addEdit(
			ConfigSet.variantsStep(
				place.configSet.language,
				configFileName(place.configSet.name)
			)
		);
	}
}
