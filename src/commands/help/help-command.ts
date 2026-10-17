import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	AbstractCommand,
	CommandRegistry,
	Extensions,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	HELP_COMMAND,
	JsonOption,
} from "../../platform/environment/args.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ProductService } from "../../platform/product/product-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { HelpDocument, helpDocumentShape } from "./help-document.js";
import { HelpPages } from "./help-pages.js";

const HelpOptions = [JsonOption] as const;

registerCommand(
	class HelpCommand extends AbstractCommand<typeof HelpOptions> {
		constructor() {
			super({
				id: HELP_COMMAND,
				metadata: {
					summary:
						"Prints usage, a command's details, or what a code means",
					description:
						"Prints usage, a command's details, or what a diagnostic code means.",
					args: [
						{
							name: "name",
							description:
								"A command, a diagnostic code such as route.strayAt, or 'codes' for the list of every code.",
							isOptional: true,
						},
						{
							name: "prefix",
							description:
								"With 'codes': only the codes that start with it, such as route or route.stray.",
							isOptional: true,
						},
					],
					options: HelpOptions,
					output: { document: helpDocumentShape },
					effects: [],
					examples: [
						"rogen help where",
						"rogen help route.strayAt",
						"rogen help codes --json",
						"rogen help codes route --json",
						"rogen help --json",
						"rogen help build --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof HelpOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const productService = accessor.get(ProductService);

			if (line.options.version) {
				const version = await productService.readVersion();
				logService.print(`rogen ${version}`);
				return ok(undefined);
			}

			const [target, prefix] = line.positionals;
			if (prefix !== undefined && target?.toLowerCase() !== "codes")
				return err(
					new UsageError(
						"help takes a second argument only after codes.",
						"Run 'rogen help codes <prefix>' for the codes that start with it."
					)
				);
			const commands = Registry.as<CommandRegistry>(
				Extensions.Commands
			).getCommands();
			const pages = new HelpPages(commands);

			if (target === undefined) {
				if (line.options.json)
					return this.printJson(
						logService,
						HelpDocument.overview(
							commands,
							await productService.readVersion()
						)
					);
				logService.print(pages.overview());
				return ok(undefined);
			}

			const found = pages.resolve(target, prefix);
			if (found === undefined) return err(pages.unknown(target));
			if (
				found.kind === "codes" &&
				HelpDocument.codes(found.prefix).codes.length === 0
			)
				return err(
					new UsageError(
						`No diagnostic code starts with "${prefix}".`,
						"Run 'rogen help codes' to see every code."
					)
				);
			if (line.options.json)
				return this.printJson(
					logService,
					found.kind === "command"
						? HelpDocument.command(found.command)
						: found.kind === "codes"
							? HelpDocument.codes(found.prefix)
							: HelpDocument.code(found.code)
				);
			logService.print(pages.textOf(found));
			return ok(undefined);
		}
	}
);
