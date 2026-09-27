import { test } from "node:test";
import assert from "node:assert/strict";
import { greet, farewell } from "../lib/greet.ts";

test("greets a named person", () => {
  assert.equal(greet("Ada"), "Hello, Ada.");
});

test("greets a stranger when the name is empty", () => {
  assert.equal(greet("   "), "Hello, stranger.");
});

test("says farewell", () => {
  assert.equal(farewell("Alan"), "Goodbye, Alan.");
});
