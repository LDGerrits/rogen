import { ResultError } from "../../../base/result.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreIndexService } from "../../../platform/fs/core-index-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockLifecycleService } from "../../../platform/lifecycle/__tests__/mock-lifecycle-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import {
	MockConfigService,
	selectionOf,
} from "../../config/__tests__/mock-config-service.js";
import { configOf, writeServiceOf } from "../../write/__tests__/fixtures.js";
import { MirrorWorkspace } from "../mirror-workspace.js";
import { ROUTES } from "./layout-fixtures.js";

describe("MirrorWorkspace", () => {
	it("should say when the project does not build", async () => {
		const fs = new MemoryFileSystemService();
		const config = configOf({ routes: ROUTES });

		const opened = await MirrorWorkspace.open(
			{
				configService: new MockConfigService([]),
				fileSystemService: fs,
				writeService: writeServiceOf(fs, new CoreIndexService(fs)),
				rojoService: {} as never,
				environmentService: new MockEnvironmentService("/repo"),
				processService: new MockProcessService(),
				lifecycleService: new MockLifecycleService(),
			},
			{
				selection: selectionOf(config),
				project: config,
				input: "x",
				cwd: "/repo",
			}
		);

		expect((opened as ResultError<Error>).error.message).toContain(
			"does not build"
		);
	});
});
