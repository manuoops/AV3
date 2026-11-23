import { FastifyInstance, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const arquivos = new Map([
  ["styles.css", { tipo: "text/css; charset=utf-8", cache: "no-cache" }],
  ["styles-refined.css", { tipo: "text/css; charset=utf-8", cache: "no-cache" }],
  ["app.js", { tipo: "text/javascript; charset=utf-8", cache: "no-cache" }]
]);
const diretorioWeb = resolve(__dirname, "../../public");
const politicaConteudo = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join("; ");

function protegerResposta(reply: FastifyReply) {
  return reply
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
    .header("Referrer-Policy", "same-origin")
    .header("Content-Security-Policy", politicaConteudo);
}

/** Serve a interface administrativa no mesmo origin da API, sem introduzir um bundler. */
export function registrarInterfaceWeb(app: FastifyInstance): void {
  app.get("/", async (_request, reply) => {
    const html = await readFile(resolve(diretorioWeb, "index.html"));
    return protegerResposta(reply)
      .header("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .send(html);
  });

  app.get<{ Params: { arquivo: string } }>("/assets/:arquivo", async (request, reply) => {
    const arquivo = arquivos.get(request.params.arquivo);
    if (!arquivo) return protegerResposta(reply).code(404).send({ erro: "Arquivo da interface não encontrado." });
    const conteudo = await readFile(resolve(diretorioWeb, request.params.arquivo));
    return protegerResposta(reply)
      .header("Cache-Control", arquivo.cache)
      .type(arquivo.tipo)
      .send(conteudo);
  });
}
