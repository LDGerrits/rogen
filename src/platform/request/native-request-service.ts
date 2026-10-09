import { ErrorUtils } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	HttpResponse,
	RequestError,
	RequestFailure,
	RequestService,
} from "./request-service.js";

/** `fetch` throws a `DOMException` on timeout and a `TypeError` with the socket's error as its cause otherwise. */
function failureOf(error: unknown): RequestFailure {
	const name = (error as { name?: unknown } | null)?.name;
	if (name === "TimeoutError" || name === "AbortError") return "timeout";
	return ErrorUtils.hasCode(
		(error as { cause?: unknown } | null)?.cause,
		"ECONNREFUSED",
		"EADDRNOTAVAIL"
	)
		? "refused"
		: "failed";
}

export class NativeRequestService implements RequestService {
	declare readonly _serviceBrand: undefined;

	async request(
		url: string,
		options: { readonly timeout: number }
	): Promise<Result<HttpResponse, RequestError>> {
		try {
			const response = await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(options.timeout),
			});
			return ok({
				status: response.status,
				contentType: response.headers.get("content-type") ?? undefined,
				body: new Uint8Array(await response.arrayBuffer()),
			});
		} catch (caught) {
			const message = (caught as { message?: unknown } | null)?.message;
			return err(
				new RequestError(
					typeof message === "string"
						? message
						: ErrorUtils.fromUnknown(caught).message,
					failureOf(caught),
					{
						cause: caught,
					}
				)
			);
		}
	}
}
