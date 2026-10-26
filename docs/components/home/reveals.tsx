"use client";

import { useEffect } from "react";

const EASE_OUT = "cubic-bezier(.16,1,.3,1)";

// Drops each part of an isometric drawing into place.
function assemble(svg: SVGSVGElement) {
	svg.querySelectorAll<SVGGElement>("[data-part]").forEach((g) => {
		const n = Number(g.dataset.part);
		g.animate(
			[
				{
					opacity: 0,
					transform: `translateY(${n === 0 ? 10 : -14}px)`,
				},
				{ opacity: 1, transform: "translateY(0)" },
			],
			{
				duration: 750,
				delay: n * 100,
				easing: EASE_OUT,
				fill: "backwards",
			}
		);
	});
}

/** Fades content below the fold up once as it scrolls into view. */
export function Reveals() {
	useEffect(() => {
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const below = (el: Element) =>
			el.getBoundingClientRect().top > innerHeight;
		const io = new IntersectionObserver(
			(entries) =>
				entries.forEach((e) => {
					if (!e.isIntersecting) return;
					const t = e.target as HTMLElement;
					io.unobserve(t);
					if (t instanceof SVGSVGElement) {
						t.style.visibility = "";
						assemble(t);
					} else t.classList.remove("pending");
				}),
			{ threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
		);
		const pending: (HTMLElement | SVGSVGElement)[] = [];
		document
			.querySelectorAll<HTMLElement>(
				".home .rv, .home [data-line], .home [data-cmds]"
			)
			.forEach((el) => {
				if (!below(el)) return;
				el.classList.add("pending");
				pending.push(el);
				io.observe(el);
			});
		if (!reduced)
			document
				.querySelectorAll<SVGSVGElement>(".home svg[data-assemble]")
				.forEach((svg) => {
					if (!below(svg)) return;
					svg.style.visibility = "hidden";
					pending.push(svg);
					io.observe(svg);
				});
		return () => {
			io.disconnect();
			pending.forEach((el) => {
				el.classList.remove("pending");
				el.style.visibility = "";
			});
		};
	}, []);

	return null;
}
