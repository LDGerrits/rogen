import path from "path";
import { mockConfig } from "../../../domain/config/__tests__/mock-config-service.js";
import { SyncWarnings, WrittenConfig } from "../../../domain/write/write.js";
import { writeEntry } from "../write-document.js";

const cwd = path.resolve("/repo");

const writtenWith = (
	outputs?: ConstructorParameters<typeof WrittenConfig>[5]
) => {
	const config = mockConfig();
	return {
		config,
		outcome: new WrittenConfig(
			config,
			"wrote",
			{ warnings: [], sync: SyncWarnings.known([]) },
			{ roots: [], routes: [], unrouted: 0, replaced: 0, displaced: 0 },
			[],
			outputs
		),
	};
};

describe("writeEntry", () => {
	it("should list no files when a config writes only its project file", () => {
		expect(writeEntry(writtenWith().outcome, cwd)).not.toHaveProperty(
			"files"
		);
	});

	it("should list each file when a config writes more than its project file", () => {
		const compiler = path.join(cwd, "compiler.project.json");
		const { config, outcome } = writtenWith([
			{ file: mockConfig().projectFile, change: "unchanged" },
			{ file: compiler, change: "wrote" },
		]);

		expect(writeEntry(outcome, cwd).files).toEqual([
			{ file: config.projectFile, outcome: "unchanged" },
			{ file: compiler, outcome: "wrote" },
		]);
	});
});
