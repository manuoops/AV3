export interface PontoRegressaoLinear {
  x: number;
  y: number;
}

export interface RegressaoLinear {
  inclinacao: number;
  intercepto: number;
}

export function calcularMedia(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;
  if (valores.some((valor) => !Number.isFinite(valor))) {
    throw new Error("A media exige valores numericos finitos.");
  }
  return valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
}

export function calcularRegressaoLinear(
  pontos: readonly PontoRegressaoLinear[]
): RegressaoLinear | null {
  if (pontos.length < 2) return null;
  if (pontos.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("A regressao linear exige pontos numericos finitos.");
  }

  const mediaX = calcularMedia(pontos.map(({ x }) => x)!);
  const mediaY = calcularMedia(pontos.map(({ y }) => y)!);
  if (mediaX === null || mediaY === null) return null;

  const variacaoX = pontos.reduce((soma, ponto) => soma + (ponto.x - mediaX) ** 2, 0);
  if (variacaoX === 0) return null;

  const covariacao = pontos.reduce(
    (soma, ponto) => soma + (ponto.x - mediaX) * (ponto.y - mediaY),
    0
  );
  const inclinacao = covariacao / variacaoX;
  return {
    inclinacao,
    intercepto: mediaY - inclinacao * mediaX
  };
}
