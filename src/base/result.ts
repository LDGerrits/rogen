import { ErrorUtils } from "./errors.js";

export type Result<T, E = Error> = ResultOk<T> | ResultError<E>;

export function ok<T>(value: T): ResultOk<T> {
	return new ResultOk(value);
}

export function err<E>(value: E): ResultError<E> {
	return new ResultError(value);
}

export function tryWith<T>(f: () => T): Result<T, Error> {
	try {
		return ok(f());
	} catch (error) {
		return err(ErrorUtils.fromUnknown(error));
	}
}

export class ResultOk<T> {
	constructor(readonly value: T) {}

	isOk(): this is ResultOk<T> {
		return true;
	}
	isErr(): this is ResultError<never> {
		return false;
	}

	map<U>(f: (value: T) => U): ResultOk<U> {
		return new ResultOk(f(this.value));
	}

	flatMap<U, E2>(f: (value: T) => Result<U, E2>): Result<U, E2> {
		return f(this.value);
	}

	unwrap(): T {
		return this.value;
	}

	unwrapOr<U>(_defaultValue: U | T): T | U {
		return this.value;
	}
}

export class ResultError<E> {
	constructor(readonly error: E) {}

	isOk(): this is ResultOk<never> {
		return false;
	}
	isErr(): this is ResultError<E> {
		return true;
	}

	map<U>(_f: (value: never) => U): ResultError<E> {
		return this;
	}

	flatMap<U, E2>(_f: (value: never) => Result<U, E2>): ResultError<E> {
		return this;
	}

	unwrap(): never {
		if (this.error instanceof Error) {
			throw this.error;
		}
		throw ErrorUtils.fromUnknown(this.error);
	}

	unwrapOr<U>(defaultValue: U): U {
		return defaultValue;
	}
}
