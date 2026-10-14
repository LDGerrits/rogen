import { Result, err, ok } from "../../base/result.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { BrowserService } from "../../platform/browser/browser-service.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { DOCS_URL } from "../../platform/product/product-service.js";
import { DocTopics } from "./doc-topics.js";

const DocOptions = [JsonOption] as const;

const DocOutput = OutputShape.union(
	OutputShape.object({
		url: OutputShape.string,
		topics: OutputShape.array(OutputShape.string),
	}),
	OutputShape.object({
		topic: OutputShape.string,
		text: OutputShape.string,
	})
);

registerCommand(
	class DocCommand extends AbstractCommand<typeof DocOptions> {
		constructor() {
			super({
				id: "doc",
				metadata: {
					description:
						"Opens the documentation in a browser, or prints one topic of it offline.",
					options: DocOptions,
					output: { document: DocOutput },
					args: [
						{
							name: "topic",
							description: `One of ${DocTopics.NAMES.join(", ")}. Without one, the documentation's address is printed, and the documentation opened in a browser when there is a terminal.`,
							isOptional: true,
						},
					],
					examples: [
						"rogen doc",
						"rogen doc routing",
						"rogen doc --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof DocOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const [topic] = line.positionals;

			if (topic !== undefined) {
				const text = DocTopics.textOf(topic);
				if (text === undefined) return err(DocTopics.unknown(topic));
				if (line.options.json)
					return this.printJson(logService, {
						topic: topic.toLowerCase(),
						text,
					});
				logService.print(text);
				return ok(undefined);
			}

			if (line.options.json)
				return this.printJson(logService, {
					url: DOCS_URL,
					topics: DocTopics.NAMES,
				});

			const environment = accessor.get(EnvironmentService);
			logService.print(DOCS_URL);
			if (environment.isInteractive)
				await accessor
					.get(BrowserService)
					.open(DOCS_URL, environment.cwd);
			return ok(undefined);
		}
	}
);
