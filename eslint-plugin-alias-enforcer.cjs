module.exports = {
  rules: {
    "enforce-aliases": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Enforce the use of path aliases instead of relative imports",
          category: "Best Practices",
          recommended: true,
        },
        fixable: "code",
        schema: [
          {
            type: "object",
            properties: {
              aliases: {
                type: "object",
                patternProperties: {
                  "^@[^/]+$": {
                    type: "string",
                  },
                },
              },
            },
          },
        ],
      },
      create(context) {
        const aliases = (context.options[0] && context.options[0].aliases) || {};
        const filename = context.getFilename();
        const cwd = context.getCwd();

        const normalizePath = path => path.replace(/\\/g, "/");
        const normalizedFilename = normalizePath(filename);
        const normalizedCwd = normalizePath(cwd);
        const currentDir = normalizedFilename.substring(0, normalizedFilename.lastIndexOf("/"));

        return {
          ImportDeclaration(node) {
            if (node.source.type === "Literal" && typeof node.source.value === "string") {
              const importPath = node.source.value;

              if (importPath.startsWith("./") || importPath.startsWith("../")) {
                let absolutePath = importPath;
                if (importPath.startsWith("./")) {
                  absolutePath = currentDir + importPath.substring(1);
                } else {
                  const parts = currentDir.split("/");
                  const importParts = importPath.split("/");
                  let depth = 0;
                  for (const part of importParts) {
                    if (part === "..") depth++;
                  }
                  const targetDir = parts.slice(0, parts.length - depth).join("/");
                  const remainingPath = importParts.slice(depth).join("/");
                  absolutePath = targetDir + "/" + remainingPath;
                }

                for (const [alias, aliasPath] of Object.entries(aliases)) {
                  const fullAliasPath = normalizedCwd + "/" + normalizePath(aliasPath).substring(2);

                  if (absolutePath.startsWith(fullAliasPath)) {
                    const relativePath = absolutePath.substring(fullAliasPath.length);
                    const suggestedPath = relativePath.startsWith("/")
                      ? alias + relativePath
                      : alias + "/" + relativePath;

                    context.report({
                      node: node.source,
                      message: `Use alias "${suggestedPath}" instead of relative import "${importPath}"`,
                      fix(fixer) {
                        return fixer.replaceText(node.source, `'${suggestedPath}'`);
                      },
                    });
                    break;
                  }
                }
              }
            }
          },
        };
      },
    },
  },
};
