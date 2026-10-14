import { decode } from "@msgpack/msgpack";
import { Result, err, tryWith } from "../../base/result.js";
import { createServiceIdentifier } from "../instantiation/instantiation.js";

export interface HttpResponse {
	readonly status: number;
	readonly contentType: string | undefined;
	readonly body: Uint8Array;
}

export type RequestFailure = "refused" | "timeout" | "failed";

export class RequestError extends Error {
	override readonly name = "RequestError";

	constructor(
		message: string,
		readonly reason: RequestFailure,
		options?: ErrorOptions
	) {
		super(message, options);
	}
}

export interface RequestOptions {
	readonly timeout: number;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface RequestService {
	readonly _serviceBrand: undefined;

	request(
		url: string,
		options: RequestOptions
	): Promise<Result<HttpResponse, RequestError>>;
}

export const RequestService =
	createServiceIdentifier<RequestService>("requestService");

export function readBody(response: HttpResponse): Result<unknown, Error> {
	const type = response.contentType?.split(";")[0].trim().toLowerCase();
	if (type === "application/msgpack" || type === "application/x-msgpack")
		return tryWith(() => decode(response.body));
	if (type === "application/json")
		return tryWith(() =>
			JSON.parse(new TextDecoder().decode(response.body))
		);
	return err(new Error(`Unexpected content type ${type ?? "(none)"}.`));
}

export const isSuccess = (response: HttpResponse): boolean =>
	response.status >= 200 && response.status < 300;
