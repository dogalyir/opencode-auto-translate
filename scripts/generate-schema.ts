import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { pluginOptionsSchema } from "../src/translation";

const schema = z.toJSONSchema(pluginOptionsSchema, {
  target: "draft-2020-12",
});

await mkdir("dist", { recursive: true });
await Bun.write(
  "dist/translate.schema.json",
  `${JSON.stringify(schema, null, 2)}\n`,
);
