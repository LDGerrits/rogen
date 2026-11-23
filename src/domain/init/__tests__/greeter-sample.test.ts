import { Luau } from "../../toolchain/luau.js";
import { workspaceOf } from "../../toolchain/__tests__/workspaces.js";
import { DEFAULT_SOURCE_PATH } from "../../config/config.js";
import { GreeterSample, TEMPLATE_SOURCE_PATHS } from "../greeter-sample.js";

describe("GreeterSample", () => {
	const sample = new GreeterSample(new Luau(), "lobby");
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
		const files = sample.place("src/lobby");

		expect(files.map(({ fileName }) => fileName)).toEqual([
			"src/lobby/Welcome/Server/Welcome.server.luau",
		]);
		expect(files[0].content).toContain('print(Greeting("lobby"))');
	});

	it("should describe one place in the README, with the commands to build and serve it", () => {
		const { content } = sample.readme("src", "rogen serve");

		expect(content).toContain("# lobby\n");
		expect(content).toContain(
			"rogen where src/Greeter/Shared/Greeting.luau"
		);
		expect(content).toContain('rogen build -o "lobby.rbxlx"');
		expect(content).toContain("rogen serve");
	});

	it("should describe several places in the README, with the editor and how to add one", () => {
		const { content } = sample.readme(
			"src/common",
			"rogen serve lobby",
			"lobby"
		);

		expect(content).toContain(
			"rogen where src/common/Greeter/Shared/Greeting.luau"
		);
		expect(content).toContain("`lobby.rogen.json`");
		expect(content).toContain("`src/lobby`");
		expect(content).toContain('rogen build lobby -o "lobby.rbxlx"');
		expect(content).toContain("```bash\nrogen serve lobby\n```");
		expect(content).toContain("rogen sourcemap lobby --watch");
		expect(content).toContain("luau-lsp analyze");
		expect(content).toContain("rogen serve match --port");
		expect(content).toContain(
			"Copy `lobby.rogen.json` to `match.rogen.json`"
		);
		expect(content).not.toContain("place/");
	});

	it("should print the command that serves the project", () => {
		const { content } = sample.readme("src", "rogen serve dist");

		expect(content).toContain("```bash\nrogen serve dist\n```");
	});

	describe("for roblox-ts", () => {
		const typescript = new GreeterSample(
			workspaceOf().languageFor("roblox-ts"),
			"lobby"
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

		it("should have both scripts import the module by relative path", () => {
			for (const { content } of typescript.feature("src").slice(1))
				expect(content).toContain(
					'import { greeting } from "../shared/Greeting";'
				);
		});

		it("should say how to add a place with its map, and to watch it from a terminal of its own", () => {
			const { content } = typescript.readme(
				"src/common",
				"rogen serve lobby",
				"lobby"
			);

			expect(content).toContain(
				"Copy `lobby.rogen.json` to `match.rogen.json` and `tsconfig.lobby.json` to `tsconfig.match.json`"
			);
			expect(content).toContain(
				"```bash\nnpx rbxtsc -w -p tsconfig.match.json\n```"
			);
		});

		it("should export the greeting", () => {
			expect(typescript.feature("src")[0].content).toBe(
				"export function greeting(who: string): string {\n\treturn `Hello, ${who}!`;\n}\n"
			);
		});

		it("should say to compile before building or serving", () => {
			const { content } = typescript.readme("src", "rogen serve");

			expect(content).toContain("npm run watch");
			expect(content.indexOf("npm run watch")).toBeLessThan(
				content.indexOf("rogen build")
			);
		});

		it("should print no Luau", () => {
			expect(typescript.place("src/lobby")[0].content).not.toContain(
				"local "
			);
		});
	});

	describe("templates", () => {
		const languages = [new Luau(), workspaceOf().languageFor("roblox-ts")];

		it("should keep each variant's code where its template has it", () => {
			expect(TEMPLATE_SOURCE_PATHS).toEqual({
				one: DEFAULT_SOURCE_PATH,
				place: "src/lobby",
			});
		});

		it.each(languages)(
			"should name the feature's folders after the routes of $id",
			(language) => {
				const folders = new GreeterSample(language, "lobby")
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
				const sample = new GreeterSample(language, "lobby");
				const scripts = [
					...sample.feature("src"),
					...sample.place("src/lobby"),
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
				const sample = new GreeterSample(language, "lobby");
				const files = [
					...sample.feature("lib"),
					...sample.place("src/lobby"),
					sample.readme("lib", "rogen serve"),
					sample.readme("src/common", "rogen serve lobby", "lobby"),
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
