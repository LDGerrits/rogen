import { Result, ok } from "../../../base/result.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "../../config/resolved-config.js";
import {
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "../../runner/rojo-command-service.js";
import { ServerMessage } from "../../runner/rojo-server.js";

export class FakeRojo implements RojoCommandService {
	declare readonly _serviceBrand: undefined;
	say: () => Promise<string[] | DiagnosticsError> = async () => [];

	run(): never {
		throw new Error("not used");
	}

	projects(): never {
		throw new Error("not used");
	}

	runBare(): never {
		throw new Error("not used");
	}

	watch(): never {
		throw new Error("not used");
	}

	async runOn(
		_selection: unknown,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>> {
		const said = await this.say();
		const project = request.project as ResolvedConfig;
		if (said instanceof DiagnosticsError)
			return ok({ project, messages: [], failure: said });
		return ok({
			project,
			messages: said.map((text): ServerMessage => ({
				severity: "unrecognised",
				text,
			})),
		});
	}
}
