import { Readable } from "stream";
import { NativeInputService } from "../native-input-service.js";

describe("NativeInputService", () => {
	it("should read all the text the stream holds, however it is split", async () => {
		const input = Readable.from([Buffer.from("aé"), "b\n", "c"]);

		expect(await new NativeInputService(input).readAll()).toBe("aéb\nc");
	});

	it("should read nothing from a stream that is empty", async () => {
		expect(await new NativeInputService(Readable.from([])).readAll()).toBe(
			""
		);
	});
});
