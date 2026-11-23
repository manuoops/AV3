import Fastify from "fastify";
import { registrarInterfaceWeb } from "../../../src/http/InterfaceWeb";

describe("interface web GreenCode", () => {
  const app = Fastify();
  registrarInterfaceWeb(app);

  afterAll(async () => app.close());

  it("serve a tela de entrada com cabeçalhos de segurança", async () => {
    const resposta = await app.inject({ method: "GET", url: "/" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toContain("text/html");
    expect(resposta.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(resposta.body).toContain("Acesse sua conta");
    expect(resposta.body).toContain("/assets/app.js");
    expect(resposta.body).not.toContain('class="brand-mark"');
  });

  it("serve os arquivos da interface e não expõe outros caminhos", async () => {
    const css = await app.inject({ method: "GET", url: "/assets/styles.css" });
    const cssRefinado = await app.inject({ method: "GET", url: "/assets/styles-refined.css" });
    const js = await app.inject({ method: "GET", url: "/assets/app.js" });
    const ausente = await app.inject({ method: "GET", url: "/assets/.env" });
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(cssRefinado.statusCode).toBe(200);
    expect(cssRefinado.headers["content-type"]).toContain("text/css");
    expect(cssRefinado.body).toContain("background: #709b61");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.body).toContain("function currentConfig() { return ({ organizacoes: organizations, contratos: contracts, lotes: lots, equipamentos: equipment, usuarios: users })[state.view]; }");
    expect(ausente.statusCode).toBe(404);
  });
});
