import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs, TabsList, TabsTrigger } from "fumadocs-ui/components/tabs";
import type { ReactNode } from "react";
import { BunIcon, NpmIcon, PnpmIcon, YarnIcon } from "@/components/icons";

/**
 * Package-manager install block. Each tab shows the install command for one
 * manager, fronted by its brand mark, so the canonical pnpm command sits
 * alongside the npm / yarn / bun equivalents instead of being the only one.
 *
 * `groupId` + `persist` sync the selected manager across every install block on
 * the site — docs pages and the landing page alike — and remember it across
 * visits (localStorage). pnpm is the default; the choice is the reader's.
 *
 * Imports the raw Fumadocs `Tabs` directly rather than the MDX-mapped `Tabs`
 * (which is `LangTabs`, the language switcher) so the two tab groups never
 * share state.
 */
const MANAGERS: ReadonlyArray<{
  id: string;
  Icon: (props: { className?: string }) => ReactNode;
  command: (packages: string) => string;
}> = [
  { id: "pnpm", Icon: PnpmIcon, command: (packages) => `pnpm add ${packages}` },
  { id: "npm", Icon: NpmIcon, command: (packages) => `npm install ${packages}` },
  { id: "yarn", Icon: YarnIcon, command: (packages) => `yarn add ${packages}` },
  { id: "bun", Icon: BunIcon, command: (packages) => `bun add ${packages}` },
];

export function Install({ packages }: { packages: string }) {
  return (
    <Tabs groupId="package-manager" persist defaultValue="pnpm">
      <TabsList>
        {MANAGERS.map(({ id, Icon }) => (
          <TabsTrigger key={id} value={id}>
            <Icon className="size-4" />
            {id}
          </TabsTrigger>
        ))}
      </TabsList>
      {MANAGERS.map(({ id, command }) => (
        <Tab key={id} value={id}>
          <DynamicCodeBlock lang="bash" code={command(packages)} />
        </Tab>
      ))}
    </Tabs>
  );
}
