import { calcularMedia, calcularRegressaoLinear } from "../../../src/analytics/Estatistica";

describe("calculos estatisticos da camada analitica", () => {
  it("retorna ausencia de media quando nao ha observacoes", () => {
    expect(calcularMedia([])).toBeNull();
  });

  it("calcula a media aritmetica", () => {
    expect(calcularMedia([2, 4, 6])).toBe(4);
  });

  it("calcula a inclinacao e o intercepto da regressao linear", () => {
    expect(calcularRegressaoLinear([
      { x: 0, y: 1 },
      { x: 10, y: 3 },
      { x: 20, y: 5 }
    ])).toEqual({ inclinacao: 0.2, intercepto: 1 });
  });

  it("informa dados insuficientes para menos de dois pontos ou x constante", () => {
    expect(calcularRegressaoLinear([{ x: 1, y: 2 }])).toBeNull();
    expect(calcularRegressaoLinear([{ x: 1, y: 2 }, { x: 1, y: 3 }])).toBeNull();
  });

  it("rejeita observacoes nao finitas", () => {
    expect(() => calcularMedia([1, Number.NaN])).toThrow("valores numericos finitos");
    expect(() => calcularRegressaoLinear([{ x: 0, y: 1 }, { x: Infinity, y: 2 }]))
      .toThrow("pontos numericos finitos");
  });
});
