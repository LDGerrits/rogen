import { jest } from "@jest/globals";
import { ReconciliationService } from "../reconciliation-service.js";
import { FileChangeType } from "../files.js";
import { FileType } from "../../fs/file-system-service.js";
import { logService } from "../../../../test/setup.js";

describe("ReconciliationService", () => {
	let service: ReconciliationService;

	beforeEach(() => {
		jest.useFakeTimers();
		service = new ReconciliationService(logService, {
			burstThreshold: 5,
			debounceMs: 100,
		});
	});

	afterEach(() => {
		service[Symbol.dispose]();
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("should flush normal events below the threshold after the trailing debounce delay", () => {
		const changeListener = jest.fn();
		service.onDidEmitChanges(changeListener);

		service.queueEvents([
			{
				type: FileChangeType.ADDED,
				path: "src/a.ts",
				fileType: FileType.File,
			},
		]);

		jest.advanceTimersByTime(50);

		service.queueEvents([
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

		service.onDidEmitChanges(changeListener);
		service.onDidRequestReconciliation(reconListener);

		service.queueEvents(
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
		const spy = jest.spyOn(logService, "warn").mockImplementation(() => {});

		const massiveArray = Array.from({ length: 150000 }).map(() => ({
			type: FileChangeType.ADDED,
			path: "src/spam.ts",
			fileType: FileType.File,
		}));

		expect(() => service.queueEvents(massiveArray)).not.toThrow();

		spy.mockRestore();
	});

	it("should lock event processing safely via the acquireLock Disposable", () => {
		const changeListener = jest.fn();
		service.onDidEmitChanges(changeListener);

		{
			using _ = service.acquireLock();

			service.queueEvents([
				{
					type: FileChangeType.ADDED,
					path: "src/ignored.ts",
					fileType: FileType.File,
				},
			]);

			jest.runAllTimers();
			expect(changeListener).not.toHaveBeenCalled();
		}

		service.queueEvents([
			{
				type: FileChangeType.ADDED,
				path: "src/accepted.ts",
				fileType: FileType.File,
			},
		]);

		jest.runAllTimers();
		expect(changeListener).toHaveBeenCalledTimes(1);
	});

	it("should ignore manual reconciliation requests if already locked", () => {
		const reconListener = jest.fn();
		service.onDidRequestReconciliation(reconListener);

		using _ = service.acquireLock();

		service.requestReconciliation();

		expect(reconListener).not.toHaveBeenCalled();
	});
});
