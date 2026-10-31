"use client";

import { useEffect } from "react";

/** Fades content below the fold up once as it scrolls into view. */
export function Reveals() {
	useEffect(() => {
		const io = new IntersectionObserver(
			(entries) =>
				entries.forEach((e) => {
					if (!e.isIntersecting) return;
					io.unobserve(e.target);
					e.target.classList.remove("pending");
				}),
			{ threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
		);
		const pending: HTMLElement[] = [];
		document
			.querySelectorAll<HTMLElement>(".home .rv, .home [data-line]")
			.forEach((el) => {
				if (el.getBoundingClientRect().top <= innerHeight) return;
				el.classList.add("pending");
				pending.push(el);
				io.observe(el);
			});
		return () => {
			io.disconnect();
			pending.forEach((el) => el.classList.remove("pending"));
		};
	}, []);

	return null;
}
