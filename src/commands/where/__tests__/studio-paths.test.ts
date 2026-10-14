import { rewriteStudioPaths, studioPathsIn } from "../studio-paths.js";

describe("studioPathsIn", () => {
	it("should find an instance path with a line, as Studio prints an error", () => {
		const text =
			"ServerScriptService.Feature.Name:12: attempt to index nil";

		const [found, ...rest] = studioPathsIn(text);

		expect(rest).toEqual([]);
		expect(found.reference.text).toBe("ServerScriptService.Feature.Name");
		expect(found.line).toBe(12);
		expect(text.slice(found.start, found.end)).toBe(
			"ServerScriptService.Feature.Name:12"
		);
	});

	it("should find the quoted form of a stack frame", () => {
		const text =
			"Script 'ServerScriptService.Feature.Name', Line 12 - function run";

		const [found] = studioPathsIn(text);

		expect(found.reference.text).toBe("ServerScriptService.Feature.Name");
		expect(found.line).toBe(12);
		expect(text.slice(found.start, found.end)).toBe(
			"Script 'ServerScriptService.Feature.Name', Line 12"
		);
	});

	it("should find a path that names the game, a name with a space, and a LocalScript or ModuleScript frame", () => {
		const found = studioPathsIn(
			[
				"game.ReplicatedStorage.Shared.Util:3: oops",
				"StarterPlayer.StarterPlayerScripts.Main Menu:9",
				"ModuleScript 'ReplicatedStorage.Shared.Util', Line 4",
				"LocalScript 'StarterPlayer.StarterPlayerScripts.Hud', Line 5",
			].join("\n")
		);

		expect(found.map(({ reference }) => reference.text)).toEqual([
			"ReplicatedStorage.Shared.Util",
			"StarterPlayer.StarterPlayerScripts.Main Menu",
			"ReplicatedStorage.Shared.Util",
			"StarterPlayer.StarterPlayerScripts.Hud",
		]);
		expect(found.map(({ line }) => line)).toEqual([3, 9, 4, 5]);
	});

	it("should find several in the order they appear", () => {
		const found = studioPathsIn(
			"a ServerScriptService.A:1 then Script 'ServerScriptService.B', Line 2 then ServerScriptService.C:3"
		);

		expect(found.map(({ line }) => line)).toEqual([1, 2, 3]);
	});

	it("should leave out what is not an instance path with a line", () => {
		expect(
			studioPathsIn(
				[
					"ServerScriptService.Feature.Name",
					"ServerScriptService.Feature.Name: attempt to index nil",
					"Foo.Bar.Baz:12",
					"src/Feature/Name.luau:12",
					"12:30:01 Loaded in 0.4s",
					"http://localhost:34872",
					"Script 'ServerScriptService.Feature.Name'",
				].join("\n")
			)
		).toEqual([]);
	});

	it("should not read a path that is the tail of a longer one", () => {
		expect(studioPathsIn("x.ServerScriptService.Name:12")).toEqual([]);
	});
});

describe("rewriteStudioPaths", () => {
	const fileOf = (files: Record<string, string>) => (text: string) =>
		files[text];

	it("should replace the path and its line with file:line and keep the rest", () => {
		const text =
			"ServerScriptService.Feature.Name:12: attempt to index nil";

		expect(
			rewriteStudioPaths(
				text,
				studioPathsIn(text),
				fileOf({
					"ServerScriptService.Feature.Name": "src/Feature/Name.luau",
				})
			)
		).toBe("src/Feature/Name.luau:12: attempt to index nil");
	});

	it("should replace the whole quoted form", () => {
		const text =
			"Script 'ServerScriptService.Feature.Name', Line 12 - function run\n";

		expect(
			rewriteStudioPaths(
				text,
				studioPathsIn(text),
				fileOf({
					"ServerScriptService.Feature.Name": "src/Feature/Name.luau",
				})
			)
		).toBe("src/Feature/Name.luau:12 - function run\n");
	});

	it("should leave a path as it is when no file is given for it", () => {
		const text = "ServerScriptService.A:1 and ServerScriptService.B:2";

		expect(
			rewriteStudioPaths(
				text,
				studioPathsIn(text),
				fileOf({ "ServerScriptService.B": "src/B.luau" })
			)
		).toBe("ServerScriptService.A:1 and src/B.luau:2");
	});
});
