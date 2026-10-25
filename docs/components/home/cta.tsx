import Link from "next/link";
import { InstallCommand } from "./install-command";
import { Reveal } from "./reveal";

export function Cta() {
	return (
		<section className="border-t border-rule bg-ink-raised px-6 py-24 lg:py-32">
			<Reveal className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-12 lg:items-end lg:gap-8">
				<h2 className="text-5xl leading-[0.95] font-bold tracking-[-0.045em] text-paper md:text-7xl lg:order-2 lg:col-span-6 lg:col-start-7 lg:text-right">
					Get started
				</h2>

				<div className="flex flex-col items-start gap-8 lg:order-1 lg:col-span-5">
					<InstallCommand />
					<Link
						href="/docs/v2/installation"
						className="group inline-flex items-center gap-1.5 text-sm font-medium text-stone-300 underline decoration-transparent underline-offset-4 transition-colors duration-200 hover:text-paper hover:decoration-stone-500"
					>
						Read the setup guide
						<span className="transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5">
							→
						</span>
					</Link>
				</div>
			</Reveal>
		</section>
	);
}
