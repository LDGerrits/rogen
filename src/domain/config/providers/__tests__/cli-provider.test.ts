import { CliConfigProvider } from "../cli-provider.js";

describe("CliConfigProvider", () => {
	it("should map CLI arguments to a raw mode overrides object", async () => {
		const cliArgs = { source: ["cli-src"], build: "cli-out" };
		const provider = new CliConfigProvider("/mock", cliArgs);

		const result = await provider.load();

		expect(result.isOk()).toBe(true);
		const config = result.unwrap() as {
			source?: string[];
			luau?: { build?: string };
		};

		expect(config.source).toEqual(["cli-src"]);
		expect(config.luau?.build).toBe("cli-out");
	});
});
