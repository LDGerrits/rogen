import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { NETWORK_TIMEOUT_MS, bundleCli } from "./harness.js";
import { Variant, follow, stepOf } from "./first-success.js";

const SOURCEMAP = ["rogen", "sourcemap", "-o", "sourcemap.json"] as const;

const GAME = "places/game";

const VARIANTS: readonly Variant[] = [
	{ name: "Luau, one place", flags: [], steps: [], served: "project" },
	{
		name: "Luau, several places",
		flags: ["--places"],
		steps: [],
		project: [GAME],
		served: "game",
	},
	{
		name: "Luau with Darklua",
		flags: ["--darklua"],
		steps: [SOURCEMAP, ["darklua", "process", "src", "dist"]],
		project: ["dist"],
		served: "project",
	},
	{
		name: "Luau with Darklua, several places",
		flags: ["--places", "--darklua"],
		steps: [
			{ in: GAME, run: SOURCEMAP },
			{
				in: GAME,
				run: ["darklua", "process", "../shared/src", "dist/shared/src"],
			},
			{ in: GAME, run: ["darklua", "process", "src", "dist/game/src"] },
		],
		project: [`${GAME}/dist.rogen.json`],
		served: "game",
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
		steps: [["npx", "rbxtsc", "-p", GAME]],
		network: true,
		project: [GAME],
		served: "game",
	},
	{
		name: "roblox-ts with Darklua",
		flags: ["--language", "roblox-ts", "--darklua"],
		steps: [
			["npx", "rbxtsc"],
			["darklua", "process", "out", "dist"],
		],
		network: true,
		project: ["dist"],
		served: "project",
	},
	{
		name: "roblox-ts with Darklua, several places",
		flags: ["--language", "roblox-ts", "--places", "--darklua"],
		steps: [
			["npx", "rbxtsc", "-p", GAME],
			{ in: GAME, run: ["darklua", "process", "out", "dist"] },
		],
		network: true,
		project: [`${GAME}/dist.rogen.json`],
		served: "game",
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
						.map(stepOf)
						.filter(({ run: [program] }) => program === "rogen")
						.map(({ run: [, command] }) => command),
					"serve",
				]);
				expect(success.pluginCalls).toBe(
					process.platform === "win32" ? 0 : 1
				);
				expect(success.unprinted).toEqual([]);
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
