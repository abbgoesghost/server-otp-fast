const axios = require("axios");
const crypto = require("crypto");

const PAYTECH_API_KEY =
  "969cce4ffc4f8026c451e58002cba136d357085c78e7c8fba555ba96eb051ad2";
const PAYTECH_API_SECRET =
  "5ef0aebfd936053011cdf7579b82e612f149deeca1c0a1d66e090e54c05b8619";
const PAYTECH_BASE_URL = "https://paytech.sn/api/payment";
const ENVIRONMENT = "test"; // test ou prod

class PayTechManager {
  constructor() {
    this.apiKey = PAYTECH_API_KEY;
    this.apiSecret = PAYTECH_API_SECRET;
  }

  // Générer une référence unique pour la commande
  generateReference() {
    return "WODI_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
  }

  // Créer une demande de paiement
  async createPaymentRequest(userId, amount, phoneNumber = null) {
    try {
      const reference = this.generateReference();

      const paymentData = {
        item_name: "Rechargement Wallet WODI",
        item_price: amount,
        currency: "XOF",
        ref_command: reference,
        command_name: `Rechargement de ${amount} XOF`,
        env: ENVIRONMENT,
        success_url: `https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/success?token=${reference}`,
        cancel_url: `https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/cancel?token=${reference}`,
        custom_field: JSON.stringify({
          userId: userId,
          type: "wallet_recharge",
          timestamp: Date.now(),
        }),
      };

      // Ne pas spécifier target_payment pour laisser toutes les méthodes disponibles
      // En mode test, certaines méthodes peuvent ne pas être activées pour votre compte
      // if (phoneNumber) {
      //   paymentData.target_payment = "Orange Money";
      // }

      // IPN URL uniquement si HTTPS disponible (production ou ngrok)
      // En dev local, on peut vérifier manuellement le statut du paiement
      // Pour activer IPN en dev: utiliser ngrok et mettre l'URL HTTPS ici
      paymentData.ipn_url =
        "https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/paytech/ipn";

      console.log("📤 Création paiement PayTech:", paymentData);

      const response = await axios.post(
        `${PAYTECH_BASE_URL}/request-payment`,
        paymentData,
        {
          headers: {
            API_KEY: this.apiKey,
            API_SECRET: this.apiSecret,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("✅ Réponse PayTech:", response.data);

      if (response.data.success === 1) {
        return {
          success: true,
          token: response.data.token,
          redirectUrl: response.data.redirect_url,
          reference: reference,
        };
      } else {
        return {
          success: false,
          message: response.data.message || "Erreur création paiement",
        };
      }
    } catch (error) {
      console.error(
        "❌ Erreur PayTech:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  }

  // Vérifier le statut d'un paiement
  async checkPaymentStatus(token) {
    try {
      console.log(`🔍 Vérification statut PayTech pour token: ${token}`);

      // PayTech utilise GET avec le token dans l'URL
      const response = await axios.get(`${PAYTECH_BASE_URL}/check/${token}`, {
        headers: {
          API_KEY: this.apiKey,
          API_SECRET: this.apiSecret,
        },
      });

      console.log(
        "✅ Réponse brute PayTech:",
        JSON.stringify(response.data, null, 2),
      );

      // PayTech peut retourner différents formats selon le statut
      const data = response.data;

      // Déterminer le statut
      let status = data.type_event || data.status || "unknown";

      return {
        success: true,
        status: status,
        data: data,
      };
    } catch (error) {
      console.error(
        "❌ Erreur vérification paiement:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  }

  // Traiter la notification IPN (Instant Payment Notification)
  async processIPN(ipnData) {
    try {
      console.log("📥 IPN reçu:", ipnData);

      // Vérifier la signature pour sécurité
      // PayTech envoie généralement: type_event, ref_command, item_price, etc.

      const { type_event, ref_command, custom_field } = ipnData;

      if (type_event === "sale_complete") {
        // Paiement réussi
        const customData = JSON.parse(custom_field || "{}");
        const userId = customData.userId;
        const amount = parseFloat(ipnData.item_price);

        return {
          success: true,
          userId: userId,
          amount: amount,
          reference: ref_command,
          status: "completed",
        };
      } else if (type_event === "sale_canceled") {
        // Paiement annulé
        return {
          success: false,
          status: "canceled",
          reference: ref_command,
        };
      }

      return {
        success: false,
        status: "unknown",
        message: "Type d'événement non reconnu",
      };
    } catch (error) {
      console.error("❌ Erreur traitement IPN:", error.message);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // Créer un paiement avec auto-submit (pour mobile)
  async createMobilePayment(
    userId,
    amount,
    phoneNumber,
    paymentMethod = "Orange Money",
  ) {
    try {
      const reference = this.generateReference();

      const paymentData = {
        item_name: "Rechargement Wallet WODI",
        item_price: amount,
        currency: "XOF",
        ref_command: reference,
        command_name: `Rechargement de ${amount} XOF`,
        env: ENVIRONMENT,
        // Ne pas spécifier target_payment - laisse toutes les méthodes disponibles
        // target_payment: paymentMethod,
        success_url: `https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/success?token=${reference}`,
        cancel_url: `https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/cancel?token=${reference}`,
        custom_field: JSON.stringify({
          userId: userId,
          type: "wallet_recharge",
          timestamp: Date.now(),
        }),
      };

      // IPN URL uniquement si HTTPS disponible
      paymentData.ipn_url =
        "https://unjagged-neonatally-jonelle.ngrok-free.dev/api/payment/paytech/ipn";

      console.log("📤 Création paiement mobile PayTech:", paymentData);

      const response = await axios.post(
        `${PAYTECH_BASE_URL}/request-payment`,
        paymentData,
        {
          headers: {
            API_KEY: this.apiKey,
            API_SECRET: this.apiSecret,
            "Content-Type": "application/json",
          },
        },
      );

      if (response.data.success === 1) {
        // Construire l'URL avec auto-submit
        const checkoutUrl = response.data.redirect_url;
        const autoSubmitUrl = `${checkoutUrl}?pn=${encodeURIComponent(phoneNumber)}&tp=${encodeURIComponent(paymentMethod)}&nac=1`;

        return {
          success: true,
          token: response.data.token,
          redirectUrl: autoSubmitUrl,
          reference: reference,
        };
      } else {
        return {
          success: false,
          message: response.data.message || "Erreur création paiement",
        };
      }
    } catch (error) {
      console.error(
        "❌ Erreur PayTech mobile:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        message: error.response?.data?.message || error.message,
      };
    }
  }
}

module.exports = PayTechManager;
