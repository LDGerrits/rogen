import { encode } from "@msgpack/msgpack";
import http from "http";
import net from "net";
import { AddressInfo } from "net";
import { NativeRequestService } from "../native-request-service.js";
import { readBody } from "../request-service.js";

const listen = (server: net.Server) =>
	new Promise<number>((resolve) =>
		server.listen(0, "127.0.0.1", () =>
			resolve((server.address() as AddressInfo).port)
		)
	);

const close = (server: net.Server) =>
	new Promise<void>((resolve) => server.close(() => resolve()));

describe("NativeRequestService", () => {
	const service = new NativeRequestService();

	it("should read a MessagePack body", async () => {
		const server = http.createServer((_request, response) => {
			response.setHeader("content-type", "application/msgpack");
			response.end(encode({ projectName: "Game" }));
		});
		const port = await listen(server);

		const response = (
			await service.request(`http://127.0.0.1:${port}/api/rojo`, {
				timeout: 2_000,
			})
		).unwrap();

		expect(response.status).toBe(200);
		expect(readBody(response).unwrap()).toEqual({ projectName: "Game" });
		await close(server);
	});

	it("should read a JSON body", async () => {
		const server = http.createServer((_request, response) => {
			response.setHeader(
				"content-type",
				"application/json; charset=utf-8"
			);
			response.end(JSON.stringify({ projectName: "Game" }));
		});
		const port = await listen(server);

		const response = (
			await service.request(`http://127.0.0.1:${port}/`, {
				timeout: 2_000,
			})
		).unwrap();

		expect(readBody(response).unwrap()).toEqual({ projectName: "Game" });
		await close(server);
	});

	it("should say a port nothing listens on refused", async () => {
		const server = net.createServer();
		const port = await listen(server);
		await close(server);

		const result = await service.request(`http://127.0.0.1:${port}/`, {
			timeout: 2_000,
		});

		expect(result.isErr() && result.error.reason).toBe("refused");
	});

	it("should give up on a server that never answers", async () => {
		const sockets: net.Socket[] = [];
		const server = net.createServer((socket) => sockets.push(socket));
		const port = await listen(server);

		const result = await service.request(`http://127.0.0.1:${port}/`, {
			timeout: 200,
		});

		expect(result.isErr() && result.error.reason).toBe("timeout");
		sockets.forEach((socket) => socket.destroy());
		await close(server);
	});
});

describe("readBody", () => {
	it("should refuse a body of another type", () => {
		const result = readBody({
			status: 200,
			contentType: "text/html",
			body: new Uint8Array(),
		});

		expect(result.isErr() && result.error.message).toBe(
			"Unexpected content type text/html."
		);
	});
});
