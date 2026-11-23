import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { NETWORK_TIMEOUT_MS, bundleCli } from "./harness.js";
import { Variant, follow } from "./first-success.js";

const VARIANTS: readonly Variant[] = [
	{ name: "Luau, one place", flags: [], steps: [], served: "project" },
	{
		name: "Luau, several places",
		flags: ["--places"],
		steps: [],
		project: ["lobby"],
		served: "lobby",
		mapped: ["lobby"],
	},
	{
		name: "roblox-ts, one place",
		flags: ["--language", "roblox-ts"],
		steps: [["npx", "rbxtsc"]],
		network: true,
		served: "project",
	},
	{
		name: "roblox-ts, several places",
		flags: ["--language", "roblox-ts", "--places"],
		steps: [["npx", "rbxtsc", "-p", "tsconfig.lobby.json"]],
		network: true,
		project: ["lobby"],
		served: "lobby",
	},
];

const online =
	process.env.ROGEN_E2E_NETWORK === "1" && process.platform !== "win32";

describeWithRojo("first success from an empty folder", () => {
	let bundle: ReturnType<typeof bundleCli>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	for (const variant of VARIANTS) {
		if (variant.network && !online) {
			it.todo(
				`${variant.name} (needs ROGEN_E2E_NETWORK=1, and not Windows)`
			);
			continue;
		}
		it(
			`should serve ${variant.name} after init and serve alone`,
			async () => {
				const success = await follow(bundle.cli, variant);

				expect(success.serving.project).toBe(variant.served);
				expect(success.commands).toEqual([
					"init",
					...variant.steps
						.filter(([program]) => program === "rogen")
						.map(([, command]) => command),
					"serve",
				]);
				expect(success.unprinted).toEqual([]);
				for (const folder of variant.mapped ?? [])
					expect(success.mappedPaths[folder]).toContain(
						"ReplicatedStorage/Shared/greeter/Greeting"
					);
				expect(success.printed).toContain(
					["rogen serve", ...(variant.project ?? [])].join(" ")
				);
				for (const line of success.printed)
					expect(line).not.toMatch(/^rogen (?!serve|sourcemap)/);
			},
			variant.network ? NETWORK_TIMEOUT_MS * 2 : 120_000
		);
	}
});
