import http from "node:http";
import { writeFileSync } from "node:fs";

export function startBillingWebhook() {
  const server = http.createServer((request, response) => {
    writeFileSync("/tmp/billing-events.log", request.url ?? "unknown");
    response.end("ok");
  });
  server.listen(process.env.PORT ?? 3000);
}
