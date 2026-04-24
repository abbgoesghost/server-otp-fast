// Script de test pour ajouter des fonds manuellement au wallet
const axios = require("axios");

const API_URL = "http://192.168.1.120:3000";

async function testAddFunds(userId, amount) {
  try {
    console.log(`🧪 Test ajout de ${amount} XOF au wallet de ${userId}`);

    const response = await axios.post(`${API_URL}/api/wallet/test-add-funds`, {
      userId: userId,
      amount: amount,
    });

    console.log("\n✅ Réponse:");
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.success) {
      console.log(`\n💰 Nouveau solde: ${response.data.balance} XOF`);
    }
  } catch (error) {
    console.error("\n❌ Erreur:");
    console.error(error.response?.data || error.message);
  }
}

// Utilisation: node test-add-funds.js USER_ID AMOUNT
const userId = process.argv[2];
const amount = parseFloat(process.argv[3]);

if (!userId || !amount) {
  console.log("Usage: node test-add-funds.js <USER_ID> <AMOUNT>");
  console.log(
    "Exemple: node test-add-funds.js 90Gg7uMK9SX2yn72RErJAAnLfIg2 1000",
  );
  process.exit(1);
}

testAddFunds(userId, amount);
