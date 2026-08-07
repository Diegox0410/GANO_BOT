import fs from "node:fs";
import path from "node:path";

const directory =
  "packages/ai-core/src/chat";

const files =
  fs.readdirSync(directory)
    .filter((name) =>
      name.endsWith(".ts"),
    );

const relativeSpecifier =
  /(["'])(\.\.?\/[^"']+)\1/g;

for (const name of files) {
  const file =
    path.join(directory, name);

  const original =
    fs.readFileSync(
      file,
      "utf8",
    );

  const updated =
    original.replace(
      relativeSpecifier,
      (match, quote, specifier) => {
        if (
          specifier.endsWith(".js") ||
          specifier.endsWith(".json")
        ) {
          return match;
        }

        return (
          quote +
          specifier +
          ".js" +
          quote
        );
      },
    );

  if (updated !== original) {
    fs.writeFileSync(
      file,
      updated,
      "utf8",
    );

    console.log(
      `Corregido: ${file}`,
    );
  }
}

console.log(
  "Imports ESM de ai-core/src/chat corregidos.",
);