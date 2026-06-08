import type { ReactNode } from "react";
import {
  Tabs as FumadocsTabs,
  TabsList,
  TabsTrigger,
  type TabsProps,
} from "fumadocs-ui/components/tabs";
import {
  BunIcon,
  ExpressIcon,
  FastifyIcon,
  GlobeIcon,
  HonoIcon,
  NestjsIcon,
  NextjsIcon,
} from "./icons";
import { GoIcon, PythonIcon, RustIcon, TypeScriptIcon } from "./lang-icons";

type IconComponent = (props: { className?: string }) => ReactNode;

/**
 * `LANG_ICONS` keys map each accepted display name to its brand mark.
 * Used to decide whether an MDX `<Tabs items={...}>` is a language
 * switcher (and therefore deserves the icon + pitch-black treatment)
 * or a generic Tabs block (which falls through to Fumadocs defaults).
 */
const LANG_ICONS: Record<string, IconComponent> = {
  TypeScript: TypeScriptIcon,
  Go: GoIcon,
  Python: PythonIcon,
  Rust: RustIcon,
};

/**
 * `FRAMEWORK_ICONS` does the same for web-framework switchers — when every
 * item is a known framework (or the framework-agnostic Fetch runtime), the
 * triggers get the framework's brand mark (the same icon-in-tab convention
 * used by the homepage hero and the sidebar), keeping the default Fumadocs
 * tab surface. `Framework-agnostic` maps to a neutral globe for "any Fetch
 * runtime".
 */
const FRAMEWORK_ICONS: Record<string, IconComponent> = {
  "Framework-agnostic": GlobeIcon,
  Hono: HonoIcon,
  Express: ExpressIcon,
  Fastify: FastifyIcon,
  NestJS: NestjsIcon,
  "Next.js": NextjsIcon,
  Bun: BunIcon,
};

const allIn = (map: Record<string, IconComponent>, items?: string[]): items is string[] =>
  Array.isArray(items) && items.length > 0 && items.every((item) => item in map);

/**
 * Mirrors Fumadocs's internal `escapeValue` — `<Tab value="TypeScript">`
 * is rewritten to `"typescript"` before reaching Radix's TabsContent. Our
 * TabsTrigger values must apply the same transform or the trigger /
 * content pair won't match and the panel will never become active.
 */
const escapeValue = (v: string) => v.toLowerCase().replace(/\s/, "-");

function IconTabs({
  items,
  icons,
  defaultIndex = 0,
  className,
  children,
  ...rest
}: TabsProps & { items: string[]; icons: Record<string, IconComponent> }) {
  return (
    <FumadocsTabs defaultValue={escapeValue(items[defaultIndex])} className={className} {...rest}>
      <TabsList>
        {items.map((item) => {
          const Icon = icons[item];
          return (
            <TabsTrigger key={item} value={escapeValue(item)}>
              <Icon className="size-4" />
              {item}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {children}
    </FumadocsTabs>
  );
}

/**
 * Drop-in replacement for Fumadocs's `<Tabs>` that swaps the simple text
 * triggers for branded icon + label triggers when every item is a known
 * programming language (also applying the pitch-black canvas) or a known
 * web framework. Any other `<Tabs>` usage falls through to Fumadocs's
 * default rendering.
 *
 * The `value` of each `<Tab>` child must match the label verbatim — same
 * contract as Fumadocs's simple items mode.
 */
export function LangTabs({
  items,
  defaultIndex = 0,
  className,
  children,
  ...rest
}: TabsProps) {
  if (allIn(LANG_ICONS, items)) {
    return (
      <IconTabs
        items={items}
        icons={LANG_ICONS}
        defaultIndex={defaultIndex}
        className={["bg-fd-background", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {children}
      </IconTabs>
    );
  }

  if (allIn(FRAMEWORK_ICONS, items)) {
    return (
      <IconTabs
        items={items}
        icons={FRAMEWORK_ICONS}
        defaultIndex={defaultIndex}
        className={className}
        {...rest}
      >
        {children}
      </IconTabs>
    );
  }

  return (
    <FumadocsTabs items={items} defaultIndex={defaultIndex} className={className} {...rest}>
      {children}
    </FumadocsTabs>
  );
}
