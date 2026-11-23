import { readFile } from "fs/promises";
import { join } from "path";
import { FastifyInstance } from "fastify";

interface SwaggerUiDist {
  getAbsoluteFSPath(): string;
}

const swaggerUiDist = require("swagger-ui-dist") as SwaggerUiDist;
const diretorioSwagger = swaggerUiDist.getAbsoluteFSPath();
const arquivosPublicos: Record<string, { contentType: string }> = {
  "swagger-ui.css": { contentType: "text/css; charset=utf-8" },
  "swagger-ui-bundle.js": { contentType: "text/javascript; charset=utf-8" },
  "swagger-ui-standalone-preset.js": { contentType: "text/javascript; charset=utf-8" },
  "favicon-32x32.png": { contentType: "image/png" }
};

const htmlSwagger = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GreenCode API — Swagger UI</title>
  <link rel="icon" type="image/png" href="/docs/favicon-32x32.png" sizes="32x32" />
  <link rel="stylesheet" href="/docs/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script src="/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/docs/json",
        dom_id: "#swagger-ui",
        deepLinking: false,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`;

export function registrarDocumentacaoSwagger(app: FastifyInstance, documento: object): void {
  app.get("/openapi.json", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send(documento));
  app.get("/docs/json", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send(documento));
  app.get("/docs", async (_request, reply) => reply.redirect("/docs/"));
  app.get("/docs/", async (_request, reply) => reply
    .header("X-Content-Type-Options", "nosniff")
    .type("text/html; charset=utf-8")
    .send(htmlSwagger));

  app.get<{ Params: { arquivo: string } }>("/docs/:arquivo", async (request, reply) => {
    const metadado = arquivosPublicos[request.params.arquivo];
    if (!metadado) return reply.code(404).send({ erro: "Arquivo da documentacao nao encontrado." });
    const conteudo = await readFile(join(diretorioSwagger, request.params.arquivo));
    return reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "public, max-age=86400")
      .type(metadado.contentType)
      .send(conteudo);
  });
}
