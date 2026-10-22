import Ajv from "ajv";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { outputJsonSchema } from "../../platform/output/__tests__/output-json-schema.js";
import { OutputNotation } from "../../platform/output/output-notation.js";
import { failureShape } from "../../platform/diagnostics/diagnostic-json.js";
import { Registry } from "../../platform/registry/registry.js";
import "../build/build-command.js";
import "../check/check-command.js";
import "../fmt-project/fmt-project-command.js";
import "../help/doc-command.js";
import "../help/help-command.js";
import "../init/init-command.js";
import "../serve/serve-command.js";
import "../where/where-command.js";

const commands = [
	...Registry.as<CommandRegistry>(Extensions.Commands).getCommands().values(),
];
const withJson = commands.filter(({ metadata }) =>
	(metadata.options ?? []).some(({ name }) => name === "json")
);

describe("the output of the commands", () => {
	it("should find the commands that print JSON", () => {
		expect(withJson.map(({ id }) => id).sort()).toEqual([
			"build",
			"check",
			"doc",
			"fmt-project",
			"help",
			"init",
			"serve",
			"where",
		]);
	});

	it.each(withJson.map((command) => [command.id, command] as const))(
		"should declare what %s prints with --json",
		(_, { metadata }) => {
			const { output } = metadata;

			expect(output?.document ?? output?.lines).toBeDefined();
		}
	);

	it.each(withJson.map((command) => [command.id, command] as const))(
		"should derive a schema and a notation from what %s declares",
		(_, { metadata }) => {
			const { output = {} } = metadata;
			const shapes = [output.document, output.lines].filter(
				(shape) => shape !== undefined
			);

			expect(() =>
				new Ajv.default({ strict: true }).compile(
					outputJsonSchema([...shapes, failureShape])
				)
			).not.toThrow();
			expect(OutputNotation.describe(output)).not.toEqual({});
			expect(() => OutputNotation.shapesOf(output)).not.toThrow();
		}
	);

	it("should declare no output for a command without --json", () => {
		const without = commands.filter(
			(command) => !withJson.includes(command)
		);

		expect(without.filter(({ metadata }) => metadata.output)).toEqual([]);
	});
});
