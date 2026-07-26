import { expect, test } from "bun:test"

test("TUI bundle keeps Solid as a host dependency", async () => {
  const packageText = await Bun.file("package.json").text()
  expect(packageText).toContain("--external 'solid-js'")
  expect(packageText).toContain('"solid-js": "1.9.12"')
})
