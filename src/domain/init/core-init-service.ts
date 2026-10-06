import path from "path";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { PromptService } from "../../platform/prompt/prompt-service.js";
import { DEFAULT_CONFIG_STEM, configFileName } from "../config/config.js";
import { ConfigService } from "../config/config-service.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";
import { ConfigSet } from "./config-set.js";
import { InitDirectory } from "./init-directory.js";
import { InitPlanBuilder, Setup } from "./init-plan-builder.js";
import { InitQuestions } from "./init-questions.js";
import { InitPlan, InitService } from "./init-service.js";
import { BaseConfigReader } from "./base-config-reader.js";
import { PlaceSetup } from "./place-setup.js";
import { ProjectSetup } from "./project-setup.js";
import { ExtendingConfigSetup } from "./extending-config-setup.js";

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
		const listing = await tryWithAsync(() =>
			this.fileSystemService.readDirectory(directory)
		);
		if (listing.isErr()) {
			return err(
				new Error(
					`Failed to read ${directory}: ${listing.error.message}`,
					{ cause: listing.error }
				)
			);
		}
		const entries = new Set(listing.value.map(([entry]) => entry));
		const base = entries.has(configFileName(DEFAULT_CONFIG_STEM))
			? await new BaseConfigReader(this.configService, directory).read(
					entries
				)
			: undefined;

		return ok(
			new InitDirectory(
				directory,
				entries,
				await this.toolchainService.detect(directory),
				names.length > 0 ? name.value : undefined,
				name.value,
				base
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
		const unnamed = this.promptService.isInteractive
			? []
			: directory.checkPlaceNamed();
		if (unnamed.length > 0) return err(new DiagnosticsError(unnamed));
		const taken = directory.checkFree(
			knownName ? [configFileName(knownName)] : []
		);
		if (taken.length > 0) return err(new DiagnosticsError(taken));

		// A new project when there is no `default.rogen.json` yet, otherwise what the user says to add beside it.
		const project = () =>
			this.planWith(
				new ProjectSetup(
					directory,
					this.questions,
					this.fileSystemService
				),
				directory
			);
		if (!directory.hasDefaultConfig) return project();
		switch (await this.questions.whatToAdd()) {
			case undefined:
				return ok(undefined);
			case "place":
				return this.planWith(
					new PlaceSetup(directory, this.questions),
					directory
				);
			case "extending":
				return this.planWith(
					new ExtendingConfigSetup(directory, this.questions),
					directory
				);
			case "separate":
				return project();
		}
	}

	/** Asks `setup` its questions, then plans what the answers write. */
	private async planWith<C>(
		setup: Setup<C>,
		directory: InitDirectory
	): Promise<Result<InitPlan | undefined, Error>> {
		const asked = await setup.ask();
		if (asked.isErr()) return err(new DiagnosticsError(asked.error));
		if (asked.value === undefined) return ok(undefined);

		const builder = new InitPlanBuilder(directory);
		setup.plan(asked.value, builder);
		const plan = builder.build();
		return plan.isErr() ? err(new DiagnosticsError(plan.error)) : plan;
	}

	async write(
		plan: InitPlan,
		onWritten: (fileName: string) => void
	): Promise<Result<void, Error>> {
		for (const { fileName, content } of plan.files) {
			const written = await tryWithAsync(() =>
				this.fileSystemService.writeFile(
					path.join(plan.directory, fileName),
					content
				)
			);
			if (written.isErr()) {
				return err(
					new Error(
						`Failed to write ${fileName}: ${written.error.message}`,
						{ cause: written.error }
					)
				);
			}
			onWritten(fileName);
		}
		return ok(undefined);
	}
}
