import defaultMdxComponents from "fumadocs-ui/mdx";
import { Tab } from "fumadocs-ui/components/tabs";
import { Install } from "@/components/install-tabs";
import { LangNotes } from "@/components/lang-notes";
import { LangTabs } from "@/components/lang-tabs";
import type { MDXComponents } from "mdx/types";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    Tab,
    Tabs: LangTabs,
    LangNotes,
    Install,
    ...components,
  };
}
