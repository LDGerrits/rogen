import fs from "fs";
import path from "path";
import { mockConfig } from "./mock-config-service.js";
import {
	DeclaredKeys,
	SCHEMA_URL,
	configFileName,
	configLabel,
	defaultOutFileName,
	labelOfDefaultOutFile,
	rootDirOverlap,
	schemaUrlFor,
} from "../config.js";

describe("domain/config/config", () => {
	describe("configFileName and configLabel", () => {
		it("should add the suffix to a stem", () => {
			expect(configFileName("lobby")).toBe("lobby.rogen.json");
		});

		it("should take the stem back out of a config path", () => {
			expect(configLabel("/repo/lobby.rogen.json")).toBe("lobby");
		});
	});

	describe("defaultOutFileName and labelOfDefaultOutFile", () => {
		it("should name the project file a config writes by default", () => {
			expect(defaultOutFileName("lobby")).toBe("lobby.project.json");
		});

		it("should take the label back out of a default output", () => {
			expect(labelOfDefaultOutFile("lobby.project.json")).toBe("lobby");
		});

		it("should not read a label out of a file that isn't a project file", () => {
			expect(labelOfDefaultOutFile("lobby.json")).toBeUndefined();
		});
	});

	describe("rootDirOverlap", () => {
		const abs = (...segments: string[]) =>
			path.resolve("/repo", ...segments);

		it("should find the root dir another one sits inside", () => {
			expect(rootDirOverlap([abs("src"), abs("src/lobby")], 1)).toEqual({
				kind: "nested",
				outer: abs("src"),
			});
		});

		it("should find a root dir listed again", () => {
			expect(rootDirOverlap([abs("src"), abs("src")], 1)).toEqual({
				kind: "duplicate",
			});
		});

		it("should leave the first of two equal root dirs alone", () => {
			expect(rootDirOverlap([abs("src"), abs("src")], 0)).toBeUndefined();
		});

		it("should be undefined for siblings", () => {
			expect(
				rootDirOverlap([abs("core"), abs("lobby")], 0)
			).toBeUndefined();
		});
	});

	describe("schemaUrlFor", () => {
		it("should point a stable release at its major", () => {
			expect(schemaUrlFor("2.1.0")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2/rogen.json"
			);
		});

		it("should point a pre-release at its exact version", () => {
			expect(schemaUrlFor("2.0.0-beta.1")).toBe(
				"https://ldgerrits.github.io/rogen/schema/2.0.0-beta.1/rogen.json"
			);
		});

		it("should match the URL init writes for the package version", () => {
			const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
				version: string;
			};
			expect(SCHEMA_URL).toBe(schemaUrlFor(pkg.version));
		});
	});

	describe("DeclaredKeys", () => {
		const routes = new DeclaredKeys(["server", "client", "shared"], []);
		const withTags = new DeclaredKeys(
			["server", "client", "shared"],
			["mock", "debug"]
		);

		it("should hold every key except the fallback route, which no name can spell", () => {
			const keys = new DeclaredKeys(["*", "server"], ["mock"]);

			expect([...keys.routeKeys]).toEqual(["server"]);
			expect([...keys.tagKeys]).toEqual(["mock"]);
			expect([...keys.all]).toEqual(["server", "mock"]);
		});

		describe("resolve", () => {
			it("should match a name spelled exactly like a declared key", () => {
				expect(routes.resolve("server")).toBe("server");
			});

			it("should match with the first letter in the other case and report the declared key", () => {
				expect(routes.resolve("Server")).toBe("server");
				expect(new DeclaredKeys(["Server"], []).resolve("server")).toBe(
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

			it("should tell a route from a tag", () => {
				expect(withTags.resolveRoute("mock")).toBeUndefined();
				expect(withTags.resolveTag("mock")).toBe("mock");
				expect(withTags.resolveRoute("Server")).toBe("server");
				expect(withTags.resolveTag("server")).toBeUndefined();
				expect(withTags.resolve("Mock")).toBe("mock");
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

		it("should say which keys are tags", () => {
			expect(withTags.isTag("mock")).toBe(true);
			expect(withTags.isTag("server")).toBe(false);
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
		it("should be asked for by the name of its file", () => {
			expect(mockConfig({ file: "/repo/lobby.rogen.json" }).label).toBe(
				"lobby"
			);
		});

		it("should build in the directory of its project file", () => {
			expect(
				mockConfig({ outFile: "/repo/out/game.project.json" })
					.projectDir
			).toBe("/repo/out");
		});

		it("should share the deepest directory of its root dirs", () => {
			expect(
				mockConfig({ rootDirs: ["/repo/a/x", "/repo/a/y"] }).commonRoot
			).toBe("/repo/a");
			expect(mockConfig({ rootDirs: [] }).commonRoot).toBeUndefined();
		});

		it("should list the tags that are on", () => {
			expect(
				mockConfig({ tags: { mock: true, debug: false } }).enabledTags
			).toEqual(["mock"]);
		});

		it("should know its declared keys from its routes and tags", () => {
			const { keys } = mockConfig({
				routes: {
					"*": "ReplicatedStorage",
					server: "ServerScriptService",
				},
				tags: { mock: true },
			});

			expect([...keys.routeKeys]).toEqual(["server"]);
			expect([...keys.tagKeys]).toEqual(["mock"]);
		});
	});

	describe("ResolvedTemplate", () => {
		const template = (
			project: Record<string, unknown>,
			file = "/repo/t.json"
		) => mockConfig({ template: { file, project } }).template!;

		it("should equal a template with the same file and project", () => {
			expect(template({ tree: {} }).equals(template({ tree: {} }))).toBe(
				true
			);
		});

		it("should differ when the project or its file does", () => {
			expect(
				template({ tree: {} }).equals(template({ tree: { A: {} } }))
			).toBe(false);
			expect(
				template({ tree: {} }).equals(
					template({ tree: {} }, "/repo/u.json")
				)
			).toBe(false);
		});

		it("should differ from no template", () => {
			expect(template({ tree: {} }).equals(undefined)).toBe(false);
		});
	});
});
