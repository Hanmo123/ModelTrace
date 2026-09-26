import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import worker from "../../worker/src/index.mjs";

const exec = promisify(execFile);
// Bundle TypeScript independently of Nuxt so the command/parser can be exercised in Node.
const output = await build({
  entryPoints: ["lib/terminal-commands.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { terminalCommand, extractTerminalAnswer } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`
);
const numbers = Array.from({ length: 300 }, (_, i) => (i % 355) + 1).join(" ");
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = JSON.parse(body);
  assert.equal(req.headers.authorization, "Bearer test-secret");
  assert.match(JSON.stringify(json), /quote'测试/);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      req.url.endsWith("/responses")
        ? {
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: numbers }],
              },
            ],
          }
        : { choices: [{ message: { content: numbers } }] },
    ),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  for (const apiType of ["chat", "responses"]) {
    for (const format of ["text", "json"]) {
      const command = terminalCommand(
        { baseUrl, apiType, model: "gpt-test", temperature: null },
        "quote'测试 1 到 355 的整数",
        "posix",
        format,
      );
      assert(
        !command.includes("test-secret"),
        "Secret must not be placed in command",
      );
      const { stdout } = await exec("bash", ["-c", command], {
        env: { ...process.env, MODELTRACE_API_KEY: "test-secret" },
        maxBuffer: 1e6,
      });
      assert.equal(extractTerminalAnswer(stdout), numbers);
      const ps = terminalCommand(
        { baseUrl, apiType, model: "gpt-test", temperature: null },
        "quote'测试",
        "powershell",
        format,
      );
      assert.match(ps, /quote''测试/);
      assert.match(ps, /Set-Clipboard/);
      assert(!ps.includes("test-secret"));
    }
  }
  assert.throws(() => extractTerminalAnswer("{invalid"), /JSON/);
  assert.throws(
    () =>
      extractTerminalAnswer(
        JSON.stringify({ error: { message: "unauthorized" } }),
      ),
    /unauthorized/,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const env = {
  SITE_ORIGIN: "https://app.example",
  RATE_LIMITER: { limit: async () => ({ success: true }) },
};
const prompt = "请直接输出 300 个 1 到 355 的整数，不要解释";
const mk = (body, headers = {}, path = "/v1/chat/completions") =>
  new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      Authorization: "Bearer test-secret",
      "X-ModelTrace-Endpoint": "https://api.vendor.com/v1",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const chatBody = {
  model: "gpt-test",
  messages: [{ role: "user", content: prompt }],
  stream: false,
};
const originalFetch = globalThis.fetch;
let called;
try {
  globalThis.fetch = async (url, opts) => {
    called = { url: String(url), opts };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: numbers } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const ok = await worker.fetch(mk(chatBody), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("access-control-allow-origin"), env.SITE_ORIGIN);
  assert.equal(called.url, "https://api.vendor.com/v1/chat/completions");
  assert.equal(called.opts.headers.Authorization, "Bearer test-secret");
  assert.equal(JSON.parse(called.opts.body).max_tokens, 4096);
  assert.equal(
    (
      await worker.fetch(
        mk(
          {
            model: "gpt-test",
            input: [
              { role: "user", content: [{ type: "input_text", text: prompt }] },
            ],
            stream: false,
          },
          {},
          "/v1/responses",
        ),
        env,
      )
    ).status,
    200,
  );
  assert.equal(called.url, "https://api.vendor.com/v1/responses");

  const allowedOrigins = [
    env.SITE_ORIGIN,
    "http://localhost",
    "https://localhost",
    "http://localhost:80",
    "https://localhost:443",
    "http://localhost:0",
    "http://localhost:1",
    "http://localhost:3000",
    "http://localhost:4200",
    "https://localhost:4200",
    "http://localhost:5173",
    "https://localhost:65535",
    "http://LOCALHOST:4200",
  ];
  for (const origin of allowedOrigins) {
    called = undefined;
    const preflight = await worker.fetch(
      new Request("https://worker.example/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization,content-type,x-modeltrace-endpoint",
        },
      }),
      env,
    );
    assert.equal(preflight.status, 204, origin);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.equal(preflight.headers.get("vary"), "Origin");
    assert.equal(called, undefined, "Preflight must not contact an upstream");
    const response = await worker.fetch(mk(chatBody, { Origin: origin }), env);
    assert.equal(response.status, 200, origin);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("vary"), "Origin");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(called.url, "https://api.vendor.com/v1/chat/completions");
  }

  for (const origin of [
    null,
    "null",
    "*",
    "localhost",
    "https://evil.example",
    "http://app.example",
    "https://app.example:4200",
    "http://127.0.0.1:4200",
    "http://[::1]:4200",
    "http://localhost.evil.example:4200",
    "https://sub.localhost:4200",
    "http://localhost.:4200",
    "http://local%68ost:4200",
    "http://localhost:65536",
    "http://localhost:-1",
    "http://localhost:",
    "http://localhost:4200/",
    "http://localhost:4200/path",
    "http://localhost:4200?",
    "http://localhost:4200#fragment",
    "http://user@localhost:4200",
    "http://localhost:4200@evil.example",
    "http://localhost:4200 http://localhost:3000",
    "http://localhost:4200,https://evil.example",
    "ftp://localhost:4200",
    "file://localhost",
    "http://localhost\\@evil.example",
  ]) {
    for (const method of ["POST", "OPTIONS"]) {
      called = undefined;
      const request =
        method === "POST"
          ? mk(chatBody)
          : new Request("https://worker.example/v1/chat/completions", {
              method,
            });
      if (origin === null) request.headers.delete("Origin");
      else request.headers.set("Origin", origin);
      const response = await worker.fetch(request, env);
      assert.equal(response.status, 403, `${method} ${origin}`);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(
        called,
        undefined,
        "Rejected origins must never be forwarded",
      );
    }
  }

  // Localhost is a CORS exception, not a bypass of configuration or proxy limits.
  const local = { Origin: "http://localhost:4200" };
  for (const missing of [{ SITE_ORIGIN: "" }, { RATE_LIMITER: undefined }]) {
    assert.equal(
      (await worker.fetch(mk(chatBody, local), { ...env, ...missing })).status,
      503,
    );
  }
  called = undefined;
  const limited = await worker.fetch(mk(chatBody, local), {
    ...env,
    RATE_LIMITER: { limit: async () => ({ success: false }) },
  });
  assert.equal(limited.status, 429);
  assert.equal(
    limited.headers.get("access-control-allow-origin"),
    local.Origin,
  );
  const noIP = mk(chatBody, local);
  noIP.headers.delete("CF-Connecting-IP");
  assert.equal((await worker.fetch(noIP, env)).status, 403);
  for (const endpoint of ["https://localhost/v1", "https://127.0.0.1/v1"]) {
    assert.equal(
      (
        await worker.fetch(
          mk(chatBody, { ...local, "X-ModelTrace-Endpoint": endpoint }),
          env,
        )
      ).status,
      403,
    );
  }
  const noAuth = mk(chatBody, local);
  noAuth.headers.delete("Authorization");
  const unauthorized = await worker.fetch(noAuth, env);
  assert.equal(unauthorized.status, 400);
  assert.equal(
    unauthorized.headers.get("access-control-allow-origin"),
    local.Origin,
  );
  assert.equal(
    called,
    undefined,
    "Local origins still require rate limiting and valid upstream/auth",
  );

  assert.equal(
    (await worker.fetch(mk(chatBody, { Origin: "https://evil.example" }), env))
      .status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        mk(chatBody, { "X-ModelTrace-Endpoint": "https://localhost/v1" }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        mk({
          ...chatBody,
          tools: [{ name: "bad" }],
          messages: [{ role: "system", content: prompt }],
        }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(mk(chatBody), {
        ...env,
        RATE_LIMITER: { limit: async () => ({ success: false }) },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await worker.fetch(
        mk(chatBody, { "X-ModelTrace-Endpoint": "https://127.0.0.1/v1" }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (await worker.fetch(mk(chatBody), { ...env, RATE_LIMITER: undefined }))
      .status,
    503,
  );
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  "PASS terminal command, JSON parsing, production/localhost CORS and proxy restrictions",
);
