import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { configFileName } from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan.js";
import { Addition, InitQuestions } from "./init-questions.js";
import { InitPlan, InitService } from "./init-service.js";
import { PlaceSetup, VariantSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";

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
		this.questions = new InitQuestions(promptService);
	}

	async plan(
		names: readonly string[]
	): Promise<Result<InitPlan | undefined, Error>> {
		const directory = await this.prepare(names);
		if (directory.isErr()) return directory;
		return this.planIn(directory.value);
	}

	private async prepare(
		names: readonly string[]
	): Promise<Result<InitDirectory, Error>> {
		const name = ConfigSet.parseName(names);
		if (name.isErr()) return name;

		const directory = this.environmentService.cwd;
		let entries: ReadonlySet<string>;
		try {
			entries = new Set(
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

		return ok(
			new InitDirectory(
				directory,
				entries,
				await this.toolchainService.detect(directory),
				names.length > 0 ? name.value : undefined,
				name.value,
				this.fileSystemService,
				this.configService
			)
		);
	}

	private async planIn(
		directory: InitDirectory
	): Promise<Result<InitPlan | undefined, Error>> {
		// A run that can't ask never gets to pick another name, so the one it has must be free.
		const knownName =
			directory.givenName ??
			(this.promptService.isInteractive ? undefined : directory.name);
		const taken = directory.checkFree(
			knownName ? [configFileName(knownName)] : []
		);
		if (taken.length > 0) return err(new DiagnosticsError(taken));

		const setup = await this.chooseSetup(directory);
		if (!setup) return ok(undefined);
		const asked = await setup.ask();
		if (asked.isErr()) return err(new DiagnosticsError(asked.error));
		if (!asked.value) return ok(undefined);

		const builder = new InitPlanBuilder(directory);
		setup.plan(builder);
		const plan = builder.build();
		return plan.isErr() ? err(new DiagnosticsError(plan.error)) : plan;
	}

	async write(
		plan: InitPlan,
		onWritten: (fileName: string) => void
	): Promise<Result<void, Error>> {
		for (const { fileName, content } of plan.files) {
			try {
				await this.fileSystemService.writeFile(
					path.join(plan.directory, fileName),
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

	/** A new project when there is no `default.rogen.json` yet, otherwise what the user says to add beside it. */
	private async chooseSetup(
		directory: InitDirectory
	): Promise<Setup | undefined> {
		const project = () => new ProjectSetup(directory, this.questions);
		if (!directory.hasDefaultConfig) return project();

		const addition = await this.questions.whatToAdd();
		if (addition === undefined) return undefined;
		const setups: Record<Addition, () => Setup> = {
			place: () => PlaceSetup.standalone(directory, this.questions),
			variant: () => new VariantSetup(directory, this.questions),
			separate: project,
		};
		return setups[addition]();
	}
}
