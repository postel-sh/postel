import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab } from "fumadocs-ui/components/tabs";
import { LangTabs } from "@/components/lang-tabs";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs: LangTabs,
    ...components,
  };
}
