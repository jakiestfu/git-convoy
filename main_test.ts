// Tests for git convoy. Pure helpers are imported directly (main.ts only
// runs its entry point under import.meta.main); CLI behavior is exercised by
// spawning the script as a subprocess.
//
// Run with: deno task test

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  decodeKeys,
  normalizeRepoUrl,
  summarizeChecks,
  tailLines,
  viewTop,
} from "./main.ts";

// ── normalizeRepoUrl ─────────────────────────────────────────────────────────

Deno.test("normalizeRepoUrl strips ssh form", () => {
  assertEquals(
    normalizeRepoUrl("git@github.com:turo/web-schumacher-app.git"),
    "turo/web-schumacher-app",
  );
});

Deno.test("normalizeRepoUrl strips https form", () => {
  assertEquals(
    normalizeRepoUrl("https://github.com/jakiestfu/git-convoy.git"),
    "jakiestfu/git-convoy",
  );
});

Deno.test("normalizeRepoUrl leaves plain slugs and non-github hosts alone", () => {
  assertEquals(normalizeRepoUrl("owner/repo"), "owner/repo");
  assertEquals(
    normalizeRepoUrl("https://gitlab.com/owner/repo"),
    "https://gitlab.com/owner/repo",
  );
});

// ── summarizeChecks ──────────────────────────────────────────────────────────

Deno.test("summarizeChecks is empty with no rollup", () => {
  assertEquals(summarizeChecks([]), { checks: "", checksColor: "" });
});

Deno.test("summarizeChecks all passing is green", () => {
  assertEquals(
    summarizeChecks([
      { conclusion: "SUCCESS" },
      { conclusion: "SKIPPED" },
      { conclusion: "NEUTRAL" },
    ]),
    { checks: "3/3", checksColor: "green" },
  );
});

Deno.test("summarizeChecks pending without failures is yellow", () => {
  assertEquals(
    summarizeChecks([{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]),
    { checks: "1/2", checksColor: "yellow" },
  );
});

Deno.test("summarizeChecks any failure is red, even with pending checks", () => {
  assertEquals(
    summarizeChecks([
      { conclusion: "SUCCESS" },
      { conclusion: "FAILURE" },
      { status: "IN_PROGRESS" },
    ]),
    { checks: "1/3", checksColor: "red" },
  );
});

Deno.test("summarizeChecks reads state and lowercase verdicts", () => {
  assertEquals(
    summarizeChecks([{ state: "success" }, { state: "error" }]),
    { checks: "1/2", checksColor: "red" },
  );
});

// ── tailLines ────────────────────────────────────────────────────────────────

Deno.test("tailLines keeps the last n lines", () => {
  assertEquals(tailLines("a\nb\nc\nd\n", 2), "c\nd");
});

Deno.test("tailLines returns short input unchanged", () => {
  assertEquals(tailLines("a\nb", 6), "a\nb");
});

// ── viewTop ──────────────────────────────────────────────────────────────────

Deno.test("viewTop is 0 when everything fits", () => {
  assertEquals(viewTop(10, 40, 5), 0);
  assertEquals(viewTop(40, 40, 39), 0);
});

Deno.test("viewTop centers the selection when content overflows", () => {
  assertEquals(viewTop(100, 20, 50), 40);
});

Deno.test("viewTop clamps at the top and bottom of the content", () => {
  assertEquals(viewTop(100, 20, 0), 0);
  assertEquals(viewTop(100, 20, 99), 80);
});

Deno.test("viewTop keeps the selection inside the window everywhere", () => {
  for (let sel = 0; sel < 100; sel++) {
    const top = viewTop(100, 20, sel);
    assert(top >= 0 && top + 20 <= 100, `top ${top} out of range at ${sel}`);
    assert(sel >= top && sel < top + 20, `sel ${sel} outside [${top}, +20)`);
  }
});

// ── decodeKeys ───────────────────────────────────────────────────────────────

Deno.test("decodeKeys splits plain characters", () => {
  assertEquals(decodeKeys("jkq"), ["j", "k", "q"]);
});

Deno.test("decodeKeys keeps arrow-key escape sequences intact", () => {
  assertEquals(decodeKeys("\x1b[A\x1b[Bj"), ["\x1b[A", "\x1b[B", "j"]);
});

Deno.test("decodeKeys treats a lone ESC as the escape key", () => {
  assertEquals(decodeKeys("\x1b"), ["\x1b"]);
});

// ── CLI subprocess tests ─────────────────────────────────────────────────────

async function runCli(
  args: string[],
  opts: { cwd?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--quiet", "--allow-all", "main.ts", ...args],
    cwd: opts.cwd ?? import.meta.dirname!,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { NO_COLOR: "1" },
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("cli --help prints usage and exits 0", async () => {
  const r = await runCli(["--help"]);
  assertEquals(r.code, 0);
  assert(r.stdout.includes("Usage: git convoy"));
  assert(r.stdout.includes("--configure"));
});

Deno.test("cli rejects unknown options", async () => {
  const r = await runCli(["--bogus"]);
  assertEquals(r.code, 1);
  assert(r.stdout.includes("Unknown option: --bogus"));
});

Deno.test("cli --dir with a missing path fails cleanly", async () => {
  const r = await runCli(["--dir", "/nonexistent/path"]);
  assertEquals(r.code, 1);
  assert(r.stderr.includes("cannot change to directory"));
});

Deno.test("cli fails outside a git repository", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const r = await runCli(["--dir", dir]);
    assertEquals(r.code, 1);
    assert(r.stderr.includes("not a git repository"));
  } finally {
    await Deno.remove(dir);
  }
});
