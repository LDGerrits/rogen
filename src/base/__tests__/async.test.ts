import { Sequencer, DeferredPromise } from "../async.js";

describe("Async Utilities", () => {
	describe("Sequencer", () => {
		it("should execute asynchronous tasks in strict sequential order", async () => {
			const sequencer = new Sequencer();
			const executionOrder: number[] = [];

			const task1 = () =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						executionOrder.push(1);
						resolve();
					}, 20);
				});

			const task2 = () =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						executionOrder.push(2);
						resolve();
					}, 5);
				});

			const p1 = sequencer.queue(task1);
			const p2 = sequencer.queue(task2);

			await Promise.all([p1, p2]);

			expect(executionOrder).toEqual([1, 2]);
		});

		it("should gracefully recover and process subsequent tasks if a task rejects", async () => {
			const sequencer = new Sequencer();
			let task3Executed = false;

			const task1 = async () => "success 1";
			const task2 = async () => {
				throw new Error("Task 2 failed");
			};
			const task3 = async () => {
				task3Executed = true;
				return "success 3";
			};

			await sequencer.queue(task1);

			await expect(sequencer.queue(task2)).rejects.toThrow(
				"Task 2 failed"
			);

			await sequencer.queue(task3);
			expect(task3Executed).toBe(true);
		});
	});

	describe("DeferredPromise", () => {
		it("should resolve the underlying promise when complete is called", async () => {
			const deferred = new DeferredPromise<string>();

			expect(deferred.isSettled).toBe(false);

			deferred.complete("resolved value");

			expect(deferred.isSettled).toBe(true);
			await expect(deferred.p).resolves.toBe("resolved value");
		});

		it("should reject the underlying promise when error is called", async () => {
			const deferred = new DeferredPromise<number>();

			expect(deferred.isSettled).toBe(false);

			deferred.error(new Error("Manual rejection"));

			expect(deferred.isSettled).toBe(true);
			await expect(deferred.p).rejects.toThrow("Manual rejection");
		});

		it("should ignore subsequent attempts to settle the promise once it is already settled", async () => {
			const deferred = new DeferredPromise<string>();

			deferred.complete("first");
			deferred.complete("second");
			deferred.error(new Error("late error"));

			await expect(deferred.p).resolves.toBe("first");
		});
	});
});
