// Script de test pour vérifier le format de réponse PayTech
const axios = require("axios");

const PAYTECH_API_KEY =
  "969cce4ffc4f8026c451e58002cba136d357085c78e7c8fba555ba96eb051ad2";
const PAYTECH_API_SECRET =
  "5ef0aebfd936053011cdf7579b82e612f149deeca1c0a1d66e090e54c05b8619";
const PAYTECH_BASE_URL = "https://paytech.sn/api/payment";

async function testCheckPayment(token) {
  try {
    console.log(`🔍 Test vérification pour token: ${token}`);

    const response = await axios.get(`${PAYTECH_BASE_URL}/check/${token}`, {
      headers: {
        API_KEY: PAYTECH_API_KEY,
        API_SECRET: PAYTECH_API_SECRET,
      },
    });

    console.log("\n✅ Réponse PayTech:");
    console.log(JSON.stringify(response.data, null, 2));

    console.log("\n📋 Analyse:");
    console.log("- type_event:", response.data.type_event);
    console.log("- status:", response.data.status);
    console.log("- custom_field:", response.data.custom_field);
    console.log("- item_price:", response.data.item_price);

    if (response.data.custom_field) {
      try {
        const customData = JSON.parse(response.data.custom_field);
        console.log("\n📦 Custom field parsé:");
        console.log(JSON.stringify(customData, null, 2));
      } catch (e) {
        console.log("⚠️ Impossible de parser custom_field");
      }
    }
  } catch (error) {
    console.error("\n❌ Erreur:");
    console.error(error.response?.data || error.message);
  }
}

// Utilisation: node test-paytech-check.js TOKEN
const token = process.argv[2];

if (!token) {
  console.log("Usage: node test-paytech-check.js <TOKEN>");
  console.log(
    "Exemple: node test-paytech-check.js WODI_1775398169753_84b38bbc",
  );
  process.exit(1);
}

testCheckPayment(token);
