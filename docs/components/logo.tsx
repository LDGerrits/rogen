import type { SVGProps } from "react";

const LOGO_PATH =
	"M18 0L82 0C91.941 0 100 8.059 100 18L100 82C100 91.941 91.941 100 82 100L18 100C8.059 100 0 91.941 0 82L0 18C0 8.059 8.059 0 18 0ZM12.5 18.75L50 50L12.5 81.25L12.5 62.5L27.5 50L12.5 37.5ZM62.5 37.5L87.5 37.5L87.5 62.5L62.5 62.5Z";

/** The Rogen mark in the current text colour. */
export function Logo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 100 100" aria-hidden="true" {...props}>
			<path fill="currentColor" fillRule="evenodd" d={LOGO_PATH} />
		</svg>
	);
}

/** The mark with the "Rogen" wordmark beside it. */
export function LogoLockup({ className = "" }: { className?: string }) {
	return (
		<span className={`inline-flex items-center gap-2 ${className}`}>
			<Logo className="size-[1.1em] shrink-0" />
			<span className="font-semibold tracking-[-0.03em]">Rogen</span>
		</span>
	);
}
