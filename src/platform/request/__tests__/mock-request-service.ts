import { encode } from "@msgpack/msgpack";
import { Result, err, ok } from "../../../base/result.js";
import {
	HttpResponse,
	RequestError,
	RequestFailure,
	RequestService,
} from "../request-service.js";
export class MockRequestService implements RequestService {
	declare readonly _serviceBrand: undefined;

	readonly responses = new Map<string, HttpResponse | RequestFailure>();
	readonly requested: string[] = [];
	answer(url: string, value: unknown): void {
		this.responses.set(url, {
			status: 200,
			contentType: "application/msgpack",
			body: encode(value),
		});
	}

	async request(url: string): Promise<Result<HttpResponse, RequestError>> {
		this.requested.push(url);
		const response = this.responses.get(url) ?? "refused";
		return typeof response === "string"
			? err(new RequestError(`${url}: ${response}`, response))
			: ok(response);
	}
}
