export interface Disposable {
	[Symbol.dispose](): void;
}
