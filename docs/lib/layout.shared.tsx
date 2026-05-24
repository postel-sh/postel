import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { PostelMark } from "@/lib/postel-mark";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="inline-flex items-center gap-2">
        <PostelMark className="size-5" />
        <span className="font-semibold">Postel</span>
      </span>
    ),
  },
  links: [
    {
      text: "Docs",
      url: "/docs",
      active: "nested-url",
    },
    {
      text: "GitHub",
      url: "https://github.com/postel-sh/postel",
      external: true,
    },
  ],
};
