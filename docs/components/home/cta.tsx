import Link from "next/link";
import { InstallCommand } from "./install-command";
import { Reveal } from "./reveal";

export function Cta() {
	return (
		<section className="relative isolate overflow-hidden border-t border-white/[0.06] px-6 py-24 lg:py-32">
			<div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[28rem] bg-[radial-gradient(ellipse_50%_60%_at_50%_100%,rgb(240_105_58/0.12),transparent_70%)]" />

			<Reveal className="mx-auto flex max-w-4xl flex-col items-center text-center">
				<h2 className="mb-10 text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-paper md:text-6xl">
					Get started
				</h2>

				<InstallCommand center />

				<Link
					href="/docs/v2/installation"
					className="group mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-stone-400 transition-colors duration-300 hover:text-paper"
				>
					Read the setup guide
					<span className="transition-transform duration-500 ease-out-expo group-hover:translate-x-1">
						→
					</span>
				</Link>
			</Reveal>
		</section>
	);
}
