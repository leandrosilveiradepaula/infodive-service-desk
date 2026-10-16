import { createServer } from "node:http";
import { handleSessionHttpRequest } from "./session-http";
import type { SessionDependencies } from "./server-session";

/** Real HTTP listener, injected verified identity and membership providers. */
export function createSessionHttpServer(dependencies: SessionDependencies) {
  return createServer(async (request, response) => {
    const result = await handleSessionHttpRequest({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: { cookie: request.headers.cookie }
    }, dependencies);
    if (result === null) {
      response.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
  });
}
