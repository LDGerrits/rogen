import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { CONFIG_SUFFIX } from "../config/config-discovery.js";
import {
	BaseConfig,
	planPlace,
	planVariant,
	readBaseConfig,
} from "./init-place.js";
import {
	InitChoices,
	InitPlan,
	hasSourceConfig,
	placeFolder,
	planInit,
	sourceStemOf,
} from "./init-plan.js";
import { InitAnswers, InitContext } from "./init-questions.js";

/** A place is planned from the resolved `default.rogen.json`, which is read here. */
export async function planAnswers(
	fileSystem: FileSystemService,
	context: InitContext,
	answers: InitAnswers,
	projectName: string
): Promise<Result<InitPlan, Diagnostic[]>> {
	const { workspace, directory, existingFiles } = context;
	if (answers.kind === "project") {
		return planProject(fileSystem, context, answers.choices, projectName);
	}
	if (answers.kind === "variant") {
		return planVariant({ name: answers.name, directory, existingFiles });
	}

	const base = context.base ?? (await readBaseConfig(fileSystem, directory));
	if (base.isErr()) return base;
	return planPlace({
		choices: answers.choices,
		base: base.value,
		workspace,
		directory,
		existingFiles,
	});
}

async function planProject(
	fileSystem: FileSystemService,
	{ workspace, directory, existingFiles }: InitContext,
	choices: InitChoices,
	projectName: string
): Promise<Result<InitPlan, Diagnostic[]>> {
	let copiedTemplate: string | undefined;
	if (choices.template.kind === "copy") {
		const source = path.join(directory, choices.template.from);
		try {
			copiedTemplate = await fileSystem.readFile(source);
		} catch (error) {
			return err([
				errorDiagnostic(
					"init.templateUnreadable",
					{ resource: source },
					`couldn't read this file to copy it: ${ErrorUtils.fromUnknown(error).message}`
				),
			]);
		}
	}

	const project = planInit({
		choices,
		projectName,
		directory,
		existingFiles,
		copiedTemplate,
	});
	if (project.isErr() || choices.places.length === 0) return project;

	const { name, language, darklua, rootDirs, syncDir } = choices;
	const base: BaseConfig = {
		rootDirs,
		...(syncDir && { syncDir }),
		...(hasSourceConfig(language, darklua) && {
			parent: `${sourceStemOf(name)}${CONFIG_SUFFIX}`,
		}),
	};
	const places: InitPlan[] = [];
	for (const place of choices.places) {
		const planned = planPlace({
			choices: { name: place, folder: placeFolder(place) },
			base,
			workspace: { ...workspace, language, darklua },
			directory,
			existingFiles,
		});
		if (planned.isErr()) return planned;
		places.push(planned.value);
	}
	return ok(withPlaces(project.value, choices.places, places));
}

/** The first place's commands stand for all of them; the shared edits come from the project. */
function withPlaces(
	project: InitPlan,
	names: readonly string[],
	places: readonly InitPlan[]
): InitPlan {
	const [first] = places;
	const [firstName, ...others] = names;
	return {
		template: project.template,
		configs: [
			...project.configs,
			...places.flatMap(({ configs }) => configs),
		],
		tsconfigs: places.flatMap(({ tsconfigs }) => tsconfigs),
		notes: project.notes,
		nextSteps: {
			setup: [
				...new Set(places.flatMap(({ nextSteps }) => nextSteps.setup)),
			],
			run: first.nextSteps.run,
			darklua: first.nextSteps.darklua,
			edits: [
				...(others.length > 0
					? [
							`Swap ${firstName} for ${others.join(" or ")} to work on another place.`,
						]
					: []),
				...project.nextSteps.edits,
			],
		},
	};
}
