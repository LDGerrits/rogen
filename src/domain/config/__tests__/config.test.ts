import path from "path";
import { mockConfig } from "./mock-config-service.js";
import { DeclaredKeys } from "../declared-keys.js";
import {
	fieldOf,
	isConfigFileName,
	isDefaultProjectFile,
	isProjectFileConfig,
	sourcePathOverlap,
} from "../config.js";

describe("domain/config/config", () => {
	describe("isProjectFileConfig", () => {
		it.each([
			"/repo/default.project.json",
			"/repo/default.project.jsonc",
			"/repo/game/lobby.project.json",
		])("should take %s for a Rojo project file", (file) => {
			expect(isProjectFileConfig(file)).toBe(true);
		});

		it.each([
			"/repo/default.rogen.json",
			"/repo/default.rogen.jsonc",
			"/repo/project.json",
		])("should not take %s for one", (file) => {
			expect(isProjectFileConfig(file)).toBe(false);
		});
	});

	describe("isDefaultProjectFile", () => {
		it.each(["/repo/default.project.json", "/repo/default.project.jsonc"])(
			"should accept %s, which Rojo reads without a name",
			(file) => {
				expect(isDefaultProjectFile(file)).toBe(true);
			}
		);

		it.each([
			"/repo/lobby.project.json",
			"/repo/xdefault.project.json",
			"/default.project.json/lobby.project.json",
		])("should not accept %s", (file) => {
			expect(isDefaultProjectFile(file)).toBe(false);
		});
	});

	describe("isConfigFileName", () => {
		it.each([
			"default.rogen.json",
			"default.rogen.jsonc",
			"dist.rogen.json",
			"release.rogen.jsonc",
		])("should accept %s", (name) => {
			expect(isConfigFileName(name)).toBe(true);
		});

		it.each([
			"rogen.json",
			"rogen.jsonc",
			".rogen.json",
			"dist.rogen.json5",
			"Rogen.json",
			"dist.project.json",
		])("should not accept %s", (name) => {
			expect(isConfigFileName(name)).toBe(false);
		});
	});

	describe("fieldOf", () => {
		const values = {
			getValue: <T>(section?: string | readonly string[]) =>
				(Array.isArray(section) &&
				section.join(".") === "rogen.compiledPath"
					? "dist"
					: undefined) as T | undefined,
		};

		it("should read a field the values hold, as the config declares it", () => {
			const compiledPath: string | undefined = fieldOf(
				values,
				"compiledPath"
			);

			expect(compiledPath).toBe("dist");
		});

		it("should give undefined for a field they lack", () => {
			expect(fieldOf(values, "routes")).toBeUndefined();
		});
	});

	describe("sourcePathOverlap", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should find the source path another one sits inside", () => {
			expect(
				sourcePathOverlap([abs("src"), abs("src/lobby")], 1)
			).toEqual({
				kind: "nested",
				outer: abs("src"),
			});
		});

		it("should find a source path listed again", () => {
			expect(sourcePathOverlap([abs("src"), abs("src")], 1)).toEqual({
				kind: "duplicate",
			});
		});

		it("should leave the first of two equal source paths alone", () => {
			expect(
				sourcePathOverlap([abs("src"), abs("src")], 0)
			).toBeUndefined();
		});

		it("should be undefined for siblings", () => {
			expect(
				sourcePathOverlap([abs("core"), abs("lobby")], 0)
			).toBeUndefined();
		});
	});

	describe("DeclaredKeys", () => {
		const routes = new DeclaredKeys(["server", "client", "shared"]);

		it("should hold every key except the fallback route, which no name can spell", () => {
			const keys = new DeclaredKeys(["*", "server"]);

			expect([...keys.routeKeys]).toEqual(["server"]);
		});

		describe("resolve", () => {
			it("should match a name spelled exactly like a declared key", () => {
				expect(routes.resolve("server")).toBe("server");
			});

			it("should match with the first letter in the other case and report the declared key", () => {
				expect(routes.resolve("Server")).toBe("server");
				expect(new DeclaredKeys(["Server"]).resolve("server")).toBe(
					"Server"
				);
			});

			it("should not match any other difference in case", () => {
				expect(routes.resolve("SERVER")).toBeUndefined();
				expect(routes.resolve("sERVER")).toBeUndefined();
			});

			it("should not match an undeclared name or an empty one", () => {
				expect(routes.resolve("Inventory")).toBeUndefined();
				expect(routes.resolve("")).toBeUndefined();
			});
		});

		describe("nearMiss", () => {
			it("should name the key a name only differs from beyond the first letter", () => {
				expect(routes.nearMiss("SERVER")).toBe("server");
				expect(routes.nearMiss("sERVER")).toBe("server");
			});

			it("should ignore a name that matches, including with the first letter flipped", () => {
				expect(routes.nearMiss("server")).toBeUndefined();
				expect(routes.nearMiss("Server")).toBeUndefined();
			});

			it("should ignore an unrelated name", () => {
				expect(routes.nearMiss("Inventory")).toBeUndefined();
			});
		});

		it("should share an identity between keys that differ only in the first letter", () => {
			expect(DeclaredKeys.identityOf("Server")).toBe(
				DeclaredKeys.identityOf("server")
			);
			expect(DeclaredKeys.identityOf("Server")).not.toBe(
				DeclaredKeys.identityOf("Servers")
			);
		});

		it("should flip the first letter", () => {
			expect(DeclaredKeys.flipFirstLetter("server")).toBe("Server");
			expect(DeclaredKeys.flipFirstLetter("Server")).toBe("server");
		});

		it.each(["a", "Server", "level2"])(
			"should accept %j as a name",
			(text) => {
				expect(DeclaredKeys.isName(text)).toBe(true);
			}
		);

		it.each(["", "2fast", "a-b", "a b", "*"])(
			"should reject %j as a name",
			(text) => {
				expect(DeclaredKeys.isName(text)).toBe(false);
			}
		);
	});

	describe("ResolvedConfig", () => {
		it("should be asked for by its project name", () => {
			expect(mockConfig({ name: "Lobby" }).label).toBe("Lobby");
		});

		it("should build in the directory of its config file", () => {
			expect(
				mockConfig({ file: "/repo/places/lobby/default.rogen.json" })
					.projectDir
			).toBe("/repo/places/lobby");
		});

		it("should write default.project.json beside its config", () => {
			expect(
				mockConfig({ file: "/repo/places/lobby/default.rogen.json" })
					.projectFile
			).toBe("/repo/places/lobby/default.project.json");
		});

		it("should list the source paths, else the folder it would have scanned", () => {
			expect(
				mockConfig({
					sourcePaths: ["/repo/a"],
					routes: { server: "ServerScriptService" },
				}).indexedPaths
			).toEqual(["/repo/a"]);
			expect(mockConfig().indexedPaths).toEqual(["/repo/src"]);
		});

		it("should share the deepest directory of its source paths", () => {
			expect(
				mockConfig({ sourcePaths: ["/repo/a/x", "/repo/a/y"] })
					.commonRoot
			).toBe("/repo/a");
			expect(mockConfig({ sourcePaths: [] }).commonRoot).toBeUndefined();
		});

		it("should know its declared keys from its routes", () => {
			const { keys } = mockConfig({
				routes: {
					"*": "ReplicatedStorage",
					server: "ServerScriptService",
				},
			});

			expect([...keys.routeKeys]).toEqual(["server"]);
		});
	});
});
