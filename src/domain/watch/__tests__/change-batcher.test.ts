import { jest } from "@jest/globals";
import { ChangeBatcher } from "../change-batcher.js";
import { FileType } from "../../../platform/fs/file-system-service.js";
import { NullLogService } from "../../../platform/log/null-log-service.js";
import { FileChangeType } from "../../../platform/fs/file-changes.js";

describe("ChangeBatcher", () => {
	let batcher: ChangeBatcher;
	let logService: NullLogService;

	beforeEach(() => {
		jest.useFakeTimers();
		logService = new NullLogService();
		batcher = new ChangeBatcher(logService, {
			burstThreshold: 5,
			debounceMs: 100,
		});
	});

	afterEach(() => {
		batcher[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should flush normal events below the threshold after the trailing debounce delay", () => {
		const changeListener = jest.fn();
		batcher.onDidEmitChanges(changeListener);

		batcher.queueEvents([
			{
				type: FileChangeType.ADDED,
				path: "src/a.ts",
				fileType: FileType.File,
			},
		]);

		jest.advanceTimersByTime(50);

		batcher.queueEvents([
			{
				type: FileChangeType.ADDED,
				path: "src/b.ts",
				fileType: FileType.File,
			},
		]);

		jest.advanceTimersByTime(50);
		expect(changeListener).not.toHaveBeenCalled();

		jest.advanceTimersByTime(50);

		expect(changeListener).toHaveBeenCalledTimes(1);
		expect(changeListener.mock.calls[0][0]).toHaveLength(2);
	});

	it("should trip the circuit immediately if the incoming queue pushes the buffer over the threshold", () => {
		const changeListener = jest.fn();
		const reconListener = jest.fn();

		batcher.onDidEmitChanges(changeListener);
		batcher.onDidOverflow(reconListener);

		batcher.queueEvents(
			Array.from({ length: 6 }).map((_, i) => ({
				type: FileChangeType.ADDED,
				path: `src/file_${i}.ts`,
				fileType: FileType.File,
			}))
		);

		expect(changeListener).not.toHaveBeenCalled();
		expect(reconListener).toHaveBeenCalledTimes(1);
	});

	it("should not crash on massive arrays", () => {
		const massiveArray = Array.from({ length: 150000 }).map(() => ({
			type: FileChangeType.ADDED,
			path: "src/spam.ts",
			fileType: FileType.File,
		}));

		expect(() => batcher.queueEvents(massiveArray)).not.toThrow();
	});
});
