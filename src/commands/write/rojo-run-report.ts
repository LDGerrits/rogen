import { ReportedError } from "../../base/errors.js";
import { formatJsonDocument } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import {
	RojoCommandService,
	RojoRunOutcome,
	RojoRunRequest,
} from "../../domain/runner/rojo-command-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutcomeLog } from "./outcome-log.js";
import {
	OptionalKey,
	OutputShape,
} from "../../platform/output/output-shape.js";
import { RojoTarget, rojoEntry } from "./rojo-entry.js";
import { configsDocument, writeEntryShape } from "./write-document.js";

export const rojoRunDocumentShape = (rojo: OutputShape | OptionalKey) =>
	OutputShape.object({
		changed: OutputShape.boolean,
		configs: OutputShape.array(writeEntryShape),
		rojo,
	});

export function rojoRunDocument(
	{ written, ran, changed }: RojoRunOutcome,
	target: RojoTarget
) {
	return {
		changed,
		configs: configsDocument(written.outcomes, target.cwd).configs,
		rojo: rojoEntry(target, ran),
	};
}

const isSayable = ({ severity, stdout }: ServerMessage) =>
	stdout !== undefined || severity === "warning" || severity === "error";

export class RojoRunReport {
	constructor(
		private readonly target: RojoTarget,
		@LogService private readonly logService: LogService,
		@RojoCommandService
		private readonly rojoCommandService: RojoCommandService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	async run(
		request: RojoRunRequest,
		json: boolean
	): Promise<Result<void, Error>> {
		const { logService, target } = this;
		const done = await this.rojoCommandService.run(request);
		if (done.isErr()) return done;
		const outcome = done.value;
		for (const note of outcome.notes) logService.warn(note);
		const { failure, ran } = outcome;
		if (json) {
			logService.result(
				formatJsonDocument(rojoRunDocument(outcome, target))
			);
			return failure
				? err(new ReportedError(failure.error))
				: ok(undefined);
		}
		const prints = request.prints === true;
		const printed = ran?.isOk() ? ran.value.printed : undefined;
		if (prints && !failure && printed !== undefined)
			logService.result(printed);
		this.instantiationService
			.createInstance(OutcomeLog, target.cwd)
			.rojoRun(outcome, target, {
				prints,
				shown:
					target.command === "sourcemap"
						? (messages) => messages.filter(isSayable)
						: undefined,
			});
		if (!failure) return ok(undefined);
		return failure.at === "rojo"
			? err(failure.error)
			: err(new ReportedError(failure.error));
	}
}
