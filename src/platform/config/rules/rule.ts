import { Result } from "../../../base/result.js";

export interface IValidationRule {
	canHandle(key: string, value: unknown): boolean;
	validate(key: string, value: unknown): Result<void, Error>;
}
