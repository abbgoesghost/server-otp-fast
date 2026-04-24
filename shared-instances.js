// Instances partagées pour éviter les duplications
// et permettre les listeners en temps réel

const PriceCalculator = require("./ride/price-calculator");

// Instance unique du calculateur de prix avec listener Realtime Database
const priceCalculator = new PriceCalculator();

module.exports = {
  priceCalculator,
};
