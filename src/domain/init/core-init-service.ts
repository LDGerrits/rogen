import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { configFileName } from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ConfigSet } from "./config-set.js";
import { InitChoices, defaultInitChoices } from "./init-choices.js";
import {
	DEFAULT_CONFIG_FILE,
	InitDiagnostics,
	existingFileDiagnostics,
	parseInitName,
	placeFolder,
} from "./init-files.js";
import { InitPlan, plannedFiles } from "./init-plan.js";
import { InitAnswers, InitContext, InitQuestions } from "./init-questions.js";
import { InitRequest, InitService } from "./init-service.js";
import {
	BaseConfig,
	baseConfigOf,
	planPlace,
	planVariant,
} from "./place-plan.js";
import { planProject } from "./project-plan.js";

const DEFAULT_PROJECT_NAME = "roblox-game";

export class CoreInitService implements InitService {
	declare readonly _serviceBrand: undefined;

	private readonly questions: InitQuestions;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly promptService: PromptService,
		private readonly environmentService: EnvironmentService,
		private readonly toolchainService: ToolchainService,
		private readonly configService: ConfigService
	) {
		this.questions = new InitQuestions(promptService, toolchainService);
	}

	async prepare(
		names: readonly string[]
	): Promise<Result<InitRequest, Error>> {
		const directory = this.environmentService.cwd;
		const name = parseInitName(names);
		if (name.isErr()) return name;

		let existingFiles: ReadonlySet<string>;
		try {
			existingFiles = new Set(
				(await this.fileSystemService.readDirectory(directory)).map(
					([entry]) => entry
				)
			);
		} catch (error) {
			return err(
				new Error(
					`Failed to read ${directory}: ${ErrorUtils.fromUnknown(error).message}`,
					{ cause: error }
				)
			);
		}

		return ok({
			directory,
			existingFiles,
			workspace: await this.toolchainService.detect(directory),
			...(names.length > 0 && { givenName: name.value }),
			name: name.value,
		});
	}

	async plan(
		request: InitRequest
	): Promise<Result<InitPlan | undefined, Diagnostic[]>> {
		const { directory, existingFiles, workspace, givenName, name } =
			request;
		const interactive = this.promptService.isInteractive;

		const knownName = givenName ?? (interactive ? undefined : name);
		const taken = existingFileDiagnostics(
			knownName ? [configFileName(knownName)] : [],
			directory,
			existingFiles
		);
		if (taken.length > 0) return err(taken);

		const context: InitContext = {
			workspace,
			directory,
			existingFiles,
			...(interactive &&
				existingFiles.has(DEFAULT_CONFIG_FILE) && {
					base: await this.readBaseConfig(directory),
				}),
		};

		let answers: InitAnswers | undefined;
		if (interactive) {
			const asked = await this.questions.ask(context, givenName);
			if (asked.isErr()) return asked;
			answers = asked.value;
		} else {
			answers = {
				kind: "project",
				choices: defaultInitChoices(
					workspace,
					this.toolchainService.getLanguage(workspace.language),
					name,
					existingFiles,
					givenName === undefined
				),
			};
		}
		if (!answers) return ok(undefined);

		return this.planAnswers(
			context,
			answers,
			path.basename(directory) || DEFAULT_PROJECT_NAME
		);
	}

	async write(
		request: InitRequest,
		plan: InitPlan,
		onWritten: (fileName: string) => void
	): Promise<Result<void, Error>> {
		for (const { fileName, content } of plannedFiles(plan)) {
			try {
				await this.fileSystemService.writeFile(
					path.join(request.directory, fileName),
					content
				);
			} catch (error) {
				return err(
					new Error(
						`Failed to write ${fileName}: ${ErrorUtils.fromUnknown(error).message}`,
						{ cause: error }
					)
				);
			}
			onWritten(fileName);
		}
		return ok(undefined);
	}

	/** A place joins the resolved `default.rogen.json`, read here when the questions didn't. */
	private async planAnswers(
		context: InitContext,
		answers: InitAnswers,
		projectName: string
	): Promise<Result<InitPlan, Diagnostic[]>> {
		const { workspace, directory, existingFiles } = context;
		if (answers.kind === "project") {
			return this.planProjectWithPlaces(
				context,
				answers.choices,
				projectName
			);
		}
		if (answers.kind === "variant") {
			return planVariant({
				name: answers.name,
				directory,
				existingFiles,
			});
		}

		const base = context.base ?? (await this.readBaseConfig(directory));
		if (base.isErr()) return base;
		return planPlace({
			choices: answers.choices,
			base: base.value,
			language: this.toolchainService.getLanguage(workspace.language),
			darklua: workspace.darklua,
			workspace,
			directory,
			existingFiles,
		});
	}

	private async readBaseConfig(
		directory: string
	): Promise<Result<BaseConfig, Diagnostic[]>> {
		const entry = await this.configService.readConfig(
			path.join(directory, DEFAULT_CONFIG_FILE)
		);
		return baseConfigOf(entry, directory);
	}

	private async planProjectWithPlaces(
		{ workspace, directory, existingFiles }: InitContext,
		choices: InitChoices,
		projectName: string
	): Promise<Result<InitPlan, Diagnostic[]>> {
		let copiedTemplate: string | undefined;
		if (choices.template.kind === "copy") {
			const source = path.join(directory, choices.template.from);
			try {
				copiedTemplate = await this.fileSystemService.readFile(source);
			} catch (error) {
				return err([
					InitDiagnostics.templateUnreadable(
						{ resource: source },
						ErrorUtils.fromUnknown(error).message
					),
				]);
			}
		}

		const project = planProject({
			choices,
			projectName,
			directory,
			existingFiles,
			copiedTemplate,
		});
		if (project.isErr() || choices.places.length === 0) return project;

		const { name, language, darklua, rootDirs, syncDir } = choices;
		const { sourceFile } = new ConfigSet(name, language, darklua);
		const base: BaseConfig = {
			rootDirs,
			...(syncDir && { syncDir }),
			...(sourceFile && { parent: sourceFile }),
		};
		const places: InitPlan[] = [];
		for (const place of choices.places) {
			const planned = planPlace({
				choices: { name: place, folder: placeFolder(place) },
				base,
				language,
				darklua,
				workspace,
				directory,
				existingFiles,
			});
			if (planned.isErr()) return planned;
			places.push(planned.value);
		}
		return ok(withPlaces(project.value, choices.places, places));
	}
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
		compilerConfigs: places.flatMap(
			({ compilerConfigs }) => compilerConfigs
		),
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
