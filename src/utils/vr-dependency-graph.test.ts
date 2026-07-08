import { describe, expect, it } from "vitest";

import { buildImportersGraph, normalizeModulePath, traceAffectedStories } from "@utils/vr-dependency-graph";

describe("normalizeModulePath", () => {
  it("normalizes windows paths and leading ./", () => {
    expect(normalizeModulePath(".\\src\\demo\\Button.tsx")).toBe("src/demo/Button.tsx");
    expect(normalizeModulePath("./src/demo/Button.tsx")).toBe("src/demo/Button.tsx");
  });
});

describe("buildImportersGraph", () => {
  it("builds reverse import edges from webpack stats modules", () => {
    const graph = buildImportersGraph([
      {
        name: "src/demo/components/DemoButton/DemoButton.tsx",
        reasons: [{ resolvedModule: "src/demo/components/DemoButton/DemoButton.stories.tsx" }],
      },
      {
        name: "src/demo/components/DemoButton/DemoButton.stories.tsx",
        reasons: [],
      },
    ]);

    expect(graph.source).toBe("preview-stats");
    expect(graph.modules.has("src/demo/components/DemoButton/DemoButton.tsx")).toBe(true);
    expect(
      graph.importers
        .get("src/demo/components/DemoButton/DemoButton.tsx")
        ?.has("src/demo/components/DemoButton/DemoButton.stories.tsx"),
    ).toBe(true);
  });

  it("ignores node_modules and external modules", () => {
    const graph = buildImportersGraph([
      {
        name: "./node_modules/react/index.js",
        reasons: [{ resolvedModule: "src/demo/components/DemoButton/DemoButton.tsx" }],
      },
    ]);

    expect(graph.modules.size).toBe(0);
  });
});

describe("traceAffectedStories", () => {
  const storyIndex = [
    {
      id: "demo-button--primary",
      importPath: "src/demo/components/DemoButton/DemoButton.stories.tsx",
    },
    {
      id: "demo-card--default",
      importPath: "src/demo/components/DemoCard/DemoCard.stories.tsx",
    },
  ];

  it("returns an empty set when no files changed", () => {
    const graph = buildImportersGraph([]);
    expect(traceAffectedStories([], graph, storyIndex).size).toBe(0);
  });

  it("traces transitive imports up to story modules", () => {
    const graph = buildImportersGraph([
      {
        name: "src/demo/components/DemoButton/DemoButton.tsx",
        reasons: [{ resolvedModule: "src/demo/components/DemoButton/DemoButton.stories.tsx" }],
      },
      {
        name: "src/demo/components/DemoButton/DemoButton.stories.tsx",
        reasons: [],
      },
      {
        name: "src/demo/components/DemoCard/DemoCard.stories.tsx",
        reasons: [],
      },
    ]);

    const affected = traceAffectedStories(["src/demo/components/DemoButton/DemoButton.tsx"], graph, storyIndex);

    expect([...affected]).toEqual(["demo-button--primary"]);
  });

  it("includes directly changed story files", () => {
    const graph = buildImportersGraph([]);
    const affected = traceAffectedStories(["src/demo/components/DemoCard/DemoCard.stories.tsx"], graph, storyIndex);
    expect([...affected]).toEqual(["demo-card--default"]);
  });
});
