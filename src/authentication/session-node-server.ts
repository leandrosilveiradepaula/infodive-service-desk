import { createServer } from "node:http";
import { handleSessionHttpRequest } from "./session-http";
import type { SessionDependencies } from "./server-session";

export function createSessionHttpServer(
  dependencies: SessionDependencies | ((headers: Readonly<Record<string, string | undefined>>) => SessionDependencies)
) {
  return createServer(async (request, response) => {
    const headers = { cookie: request.headers.cookie };
    const scoped = typeof dependencies === "function" ? dependencies(headers) : dependencies;
    const result = await handleSessionHttpRequest({
      method: request.method ?? "", url: request.url ?? "", headers
    }, scoped);
    if (!result) {
      response.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
  });
}
