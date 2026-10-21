import { Luau } from "../../toolchain/luau.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DEFAULT_SOURCE_PATH } from "../../config/config.js";
import { GreeterSample, TEMPLATE_SOURCE_PATHS } from "../greeter-sample.js";

describe("GreeterSample", () => {
	const sample = new GreeterSample(new Luau(), "game");
	const fileNamed = (files: { fileName: string }[], name: string) =>
		files.find(({ fileName }) => fileName === name) as {
			fileName: string;
			content: string;
		};

	it("should put the feature in the folders its routes are named after", () => {
		expect(sample.feature("src").map(({ fileName }) => fileName)).toEqual([
			"src/Greeter/Shared/Greeting.luau",
			"src/Greeter/Server/Greeter.server.luau",
			"src/Greeter/Client/Greeter.client.luau",
		]);
	});

	it("should have both scripts require the module at the path rogen where prints", () => {
		const files = sample.feature("src");

		for (const name of [
			"src/Greeter/Server/Greeter.server.luau",
			"src/Greeter/Client/Greeter.client.luau",
		])
			expect(fileNamed(files, name).content).toContain(
				'local ReplicatedStorage = game:GetService("ReplicatedStorage")\n\nlocal Greeting = require(ReplicatedStorage.Shared.Greeter.Greeting)'
			);
	});

	it("should greet from each side", () => {
		const files = sample.feature("src");

		expect(
			fileNamed(files, "src/Greeter/Server/Greeter.server.luau").content
		).toContain('print(Greeting("server"))');
		expect(
			fileNamed(files, "src/Greeter/Client/Greeter.client.luau").content
		).toContain('print(Greeting("client"))');
	});

	it("should put the script of a place in its own feature", () => {
		const files = sample.place("places/game/src");

		expect(files.map(({ fileName }) => fileName)).toEqual([
			"places/game/src/Game/Server/Game.server.luau",
		]);
		expect(files[0].content).toContain('print(Greeting("game"))');
	});

	it("should describe one place in the README, with the commands to build and serve it", () => {
		const { content } = sample.readme("src");

		expect(content).toContain("# game\n");
		expect(content).toContain(
			"rogen where src/Greeter/Shared/Greeting.luau"
		);
		expect(content).toContain('rogen build -o "game.rbxlx"');
		expect(content).toContain("rogen serve");
	});

	it("should describe several places in the README, with the workspace file and how to add one", () => {
		const { content } = sample.readme("places/shared/src", "places/game");

		expect(content).toContain(
			"rogen where places/shared/src/Greeter/Shared/Greeting.luau"
		);
		expect(content).toContain("`game.code-workspace`");
		expect(content).toContain('rogen build places/game -o "game.rbxlx"');
		expect(content).toContain("rogen init places/lobby");
	});

	describe("for roblox-ts", () => {
		const typescript = new GreeterSample(
			workspaceOf().languageFor("roblox-ts"),
			"game"
		);

		it("should write TypeScript in the folders its routes are named after", () => {
			expect(
				typescript.feature("src").map(({ fileName }) => fileName)
			).toEqual([
				"src/Greeter/shared/Greeting.ts",
				"src/Greeter/server/Greeter.server.ts",
				"src/Greeter/client/Greeter.client.ts",
			]);
		});

		it("should have both scripts import the module through the routed path", () => {
			for (const { content } of typescript.feature("src").slice(1))
				expect(content).toContain(
					'import { greeting } from "Greeter/shared/Greeting";'
				);
		});

		it("should export the greeting", () => {
			expect(typescript.feature("src")[0].content).toBe(
				"export function greeting(who: string): string {\n\treturn `Hello, ${who}!`;\n}\n"
			);
		});

		it("should say to compile before building or serving", () => {
			const { content } = typescript.readme("src");

			expect(content).toContain("npm run watch");
			expect(content.indexOf("npm run watch")).toBeLessThan(
				content.indexOf("rogen build")
			);
		});

		it("should print no Luau", () => {
			expect(
				typescript.place("places/game/src")[0].content
			).not.toContain("local ");
		});
	});

	describe("templates", () => {
		const languages = [new Luau(), workspaceOf().languageFor("roblox-ts")];

		it("should keep each variant's code where its template has it", () => {
			expect(TEMPLATE_SOURCE_PATHS).toEqual({
				one: DEFAULT_SOURCE_PATH,
				shared: "places/shared/src",
				place: "places/game/src",
			});
		});

		it.each(languages)(
			"should name the feature's folders after the routes of $id",
			(language) => {
				const folders = new GreeterSample(language, "game")
					.feature("src")
					.map(({ fileName }) => fileName.split("/")[2]);

				expect(folders.sort()).toEqual(
					["shared", "server", "client"]
						.map((route) => language.routeKey(route))
						.sort()
				);
			}
		);

		it.each(languages)(
			"should write every file of $id with its extension",
			(language) => {
				const sample = new GreeterSample(language, "game");
				const scripts = [
					...sample.feature("src"),
					...sample.place("places/game/src"),
				];

				expect(scripts).toHaveLength(4);
				for (const { fileName } of scripts)
					expect(fileName).toMatch(
						new RegExp(`\\.${language.extension}$`)
					);
			}
		);

		it.each(languages)(
			"should fill every placeholder of $id",
			(language) => {
				const sample = new GreeterSample(language, "game");
				const files = [
					...sample.feature("lib"),
					...sample.place("places/game/src"),
					sample.readme("lib"),
					sample.readme("places/shared/src", "places/game"),
				];

				for (const { content } of files)
					expect(content).not.toContain("{{");
			}
		);

		it("should leave a Luau interpolation alone", () => {
			expect(sample.feature("src")[0].content).toContain(
				"`Hello, {who}!`"
			);
		});
	});
});
