// Executado pelo electron-builder só quando o app foi assinado (Authenticode no Windows),
// antes de gerar o instalador. A assinatura de código altera o .exe e invalidaria a
// assinatura VMP do castLabs feita no after-pack: ela é refeita aqui, por cima.
// Ordem final: fuses → assinatura de código → VMP.
const { vmpSign } = require('./after-pack.cjs');

exports.default = async function afterSign(context) {
  vmpSign(context);
};
