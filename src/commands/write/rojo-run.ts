import { Result, ok } from "../../base/result.js";
import {
	ConfigSelection,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	RojoCommandRun,
	RojoCommandService,
} from "../../domain/runner/rojo-command-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";
import { WriteRun } from "../../domain/write/write.js";
import { WriteService } from "../../domain/write/write-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutcomeLog } from "./outcome-log.js";
import {
	reportRojo,
	reportRojoBesideFailure,
	rojoDone,
} from "./report-rojo.js";
import { RojoPlan, RojoStep } from "./rojo-step.js";

/** What the write and the Rojo run after it did. */
export interface RojoRunResult {
	readonly selection: ConfigSelection;
	readonly plan: RojoPlan | undefined;
	readonly written: WriteRun;
	/** Why the write failed, which leaves Rojo unrun. */
	readonly failure: Error | undefined;
	/** Rojo's run; none when the write failed or the files are broken. */
	readonly ran: Result<RojoCommandRun, Error> | undefined;
	/** Why Rojo's run failed: its error, else its failure. */
	readonly rojoFailure: Error | undefined;
}

/** One write of the selected project file and the step's Rojo command on it, as `WriteWatch` runs them on every change. */
export class RojoRun {
	constructor(
		private readonly configs: readonly string[],
		private readonly step: RojoStep,
		private readonly cwd: string,
		@ConfigService private readonly configService: ConfigService,
		@WriteService private readonly writeService: WriteService,
		@RojoCommandService
		private readonly rojoCommandService: RojoCommandService,
		@LogService private readonly logService: LogService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	/** `extraFlags` follow the plan's own. */
	async run(
		extraFlags: readonly string[] = []
	): Promise<Result<RojoRunResult, Error>> {
		if (this.step.prints) this.logService.reserveStdout();
		const selection = await this.configService.selectForRojo(this.configs);
		if (selection.isErr()) return selection;
		for (const note of selection.value.notes) this.logService.warn(note);

		const planned = this.step.plan(selection.value);
		if (planned.isErr()) return planned;
		const plan = planned.value;

		const written = await this.writeService.write(selection.value);
		const failure = written.failure();
		const ran =
			failure || plan === undefined
				? undefined
				: await this.rojoCommandService.run(selection.value, {
						command: this.step.command,
						flags: [...plan.flags, ...extraFlags],
						cwd: plan.cwd,
						project: plan.project,
					});
		const rojoFailure =
			ran === undefined
				? undefined
				: ran.isErr()
					? ran.error
					: ran.value.failure;
		return ok({
			selection: selection.value,
			plan,
			written,
			failure,
			ran,
			rojoFailure,
		});
	}

	/** The write's outcomes, then the messages of Rojo's that `shown` keeps, then the closing line unless the run's result went to the screen. */
	report(
		{ selection, plan, written, ran, rojoFailure }: RojoRunResult,
		shown: (
			messages: readonly ServerMessage[]
		) => readonly ServerMessage[] = (messages) => messages
	): void {
		const { command } = this.step;
		const outcomeLog = this.instantiationService.createInstance(
			OutcomeLog,
			this.cwd
		);
		outcomeLog.outcomes(written, selection.home, command);
		if (ran?.isOk())
			(rojoFailure ? reportRojoBesideFailure : reportRojo)(
				this.logService,
				shown(ran.value.messages),
				this.cwd
			);
		if (plan === undefined || !this.step.prints)
			outcomeLog.close(written, command, true, {
				said: rojoDone(this.step.target, this.cwd),
				failed: rojoFailure !== undefined,
			});
	}
}
