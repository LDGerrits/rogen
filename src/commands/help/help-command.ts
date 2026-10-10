import { Result, err, ok } from "../../base/result.js";
import {
	AbstractCommand,
	CommandService,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, HELP_COMMAND } from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { HelpPages } from "./help-pages.js";

registerCommand(
	class HelpCommand extends AbstractCommand {
		constructor() {
			super({
				id: HELP_COMMAND,
				metadata: {
					description:
						"Prints usage, a command's details, a topic, or what a diagnostic code means.",
					args: [
						{
							name: "name",
							description:
								"A command, a topic, or a diagnostic code such as route.strayAt.",
							isOptional: true,
						},
					],
					examples: [
						"rogen help where",
						"rogen help routing",
						"rogen help route.strayAt",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<readonly []>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);

			if (line.options.version) {
				const version = await accessor.get(ProductService).getVersion();
				logService.print(`rogen ${version}`);
				return ok(undefined);
			}

			// `rogen build --help` and `rogen help build` both name the command.
			const [target] = line.positionals;

			const pages = new HelpPages(
				accessor.get(CommandService).getCommands()
			);
			if (target === undefined) {
				logService.print(pages.overview());
				return ok(undefined);
			}

			const text = pages.find(target);
			if (text === undefined) return err(pages.unknown(target));
			logService.print(text);
			return ok(undefined);
		}
	}
);
