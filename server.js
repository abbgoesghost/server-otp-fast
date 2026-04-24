const express = require("express");
const cors = require("cors");
const WhatsAppClient = require("./otp/whatsapp-client");
const OTPManager = require("./otp/otp-manager");
const PresenceManager = require("./presence/presence-manager");
const CustomerLocationManager = require("./customers/customer-location-manager");
const DriverLocationManager = require("./drivers/driver-location-manager");
const WalletManager = require("./wallet/wallet-manager");
const PayTechManager = require("./payment/paytech-manager");
const { priceCalculator } = require("./shared-instances");
const rideRoutes = require("./routes/ride-routes");
const notificationRoutes = require("./routes/notification-routes");
const analyticsRoutes = require("./routes/analytics-routes");
const ecommerceRoutes = require("./routes/ecommerce-routes");
const promoRoutes = require("./routes/promo-routes");
const pricingRoutes = require("./routes/pricing-routes");
const admin = require("./config/firebase-admin");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes pour les courses
app.use("/api/ride", rideRoutes);

// Routes pour les notifications
app.use("/api/notifications", notificationRoutes);

// Routes pour les analytics
app.use("/api/analytics", analyticsRoutes);

// Routes pour l'e-commerce
app.use("/api/ecommerce", ecommerceRoutes);

// Routes pour les promotions
app.use("/api/promo", promoRoutes);

// Routes pour la politique de prix
app.use("/api/pricing", pricingRoutes);

const whatsappClient = new WhatsAppClient();
const otpManager = new OTPManager();
const presenceManager = new PresenceManager();
const customerLocationManager = new CustomerLocationManager();
const driverLocationManager = DriverLocationManager; // Déjà une instance
const walletManager = new WalletManager();
const payTechManager = new PayTechManager();
// priceCalculator est importé depuis shared-instances.js

// ⚠️ WhatsApp désactivé temporairement pour éviter les crashes
console.log("⚠️ WhatsApp désactivé - Mode développement");

// Nettoyer les OTP expirés toutes les minutes
setInterval(() => {
  otpManager.cleanExpiredOTPs();
}, 60000);

app.post("/api/create-auth-token", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone requis",
      });
    }

    console.log(`🔑 Création token pour: ${phoneNumber}`);

    // Créer ou récupérer l'utilisateur
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
    } catch (error) {
      // Utilisateur n'existe pas, le créer
      userRecord = await admin.auth().createUser({
        phoneNumber: phoneNumber,
      });
      console.log(`👤 Nouvel utilisateur créé: ${userRecord.uid}`);
    }

    // Créer un custom token
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    console.log(`✅ Token créé pour ${phoneNumber}`);

    res.json({
      success: true,
      token: customToken,
      uid: userRecord.uid,
    });
  } catch (error) {
    console.error("❌ Erreur création token:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du token",
    });
  }
});

// Nettoyer les OTP expirés toutes les minutes
setInterval(() => {
  otpManager.cleanExpiredOTPs();
}, 60000);

app.post("/api/send-otp", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    console.log(`📞 Demande d'OTP pour: ${phoneNumber}`);

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone requis",
      });
    }

    const otp = otpManager.generateOTP();
    otpManager.storeOTP(phoneNumber, otp);

    console.log(`🔐 OTP généré: ${otp}`);

    try {
      if (whatsappClient.isReady) {
        await whatsappClient.sendOTP(phoneNumber, otp);
        console.log(`✅ OTP envoyé via WhatsApp à ${phoneNumber}`);
      } else {
        console.log(`⚠️ WhatsApp non connecté - OTP affiché en console`);
        console.log(`📱 ${phoneNumber} - CODE: ${otp}`);
      }

      res.json({
        success: true,
        message: "OTP envoyé avec succès",
      });
    } catch (whatsappError) {
      console.error(`❌ Erreur WhatsApp:`, whatsappError.message);
      console.log(`📱 ${phoneNumber} - CODE (fallback): ${otp}`);

      res.json({
        success: true,
        message: "OTP généré (voir console serveur)",
      });
    }
  } catch (error) {
    console.error("❌ Erreur:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'envoi de l'OTP",
    });
  }
});

app.post("/api/verify-otp", (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: "Numéro et OTP requis",
      });
    }

    const result = otpManager.verifyOTP(phoneNumber, otp);
    res.json(result);
  } catch (error) {
    console.error("Erreur:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification",
    });
  }
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    whatsappReady: whatsappClient.isReady,
  });
});

app.post("/api/driver/presence/update", async (req, res) => {
  try {
    const { driverId, status } = req.body;

    if (!driverId || !status) {
      return res.status(400).json({
        success: false,
        message: "driverId et status requis",
      });
    }

    const result = await presenceManager.updateDriverPresence(driverId, status);
    res.json(result);
  } catch (error) {
    console.error("Erreur update présence:", error);
    res.status(500).json({
      success: false,
      message: "Erreur mise à jour présence",
    });
  }
});

app.post("/api/driver/presence/heartbeat", async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: "driverId requis",
      });
    }

    const result = await presenceManager.heartbeat(driverId);
    res.json(result);
  } catch (error) {
    console.error("Erreur heartbeat:", error);
    res.status(500).json({
      success: false,
      message: "Erreur heartbeat",
    });
  }
});

app.get("/api/driver/presence/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const presence = await presenceManager.getDriverPresence(driverId);

    if (!presence) {
      return res.status(404).json({
        success: false,
        message: "Chauffeur non trouvé",
      });
    }

    res.json({
      success: true,
      presence,
    });
  } catch (error) {
    console.error("Erreur get présence:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération présence",
    });
  }
});

// Routes pour les customers
app.post("/api/customer/location/update", async (req, res) => {
  try {
    const { customerId, location, heading } = req.body;

    if (!customerId || !location) {
      return res.status(400).json({
        success: false,
        message: "customerId et location requis",
      });
    }

    const result = await customerLocationManager.updateCustomerLocation(
      customerId,
      location,
      heading,
    );

    res.json({
      success: true,
      customer: result,
    });
  } catch (error) {
    console.error("Erreur update location customer:", error);
    res.status(500).json({
      success: false,
      message: "Erreur mise à jour location",
    });
  }
});

app.get("/api/customers/all", (req, res) => {
  try {
    const customers = customerLocationManager.getAllCustomers();
    res.json({
      success: true,
      customers,
      count: customers.length,
    });
  } catch (error) {
    console.error("Erreur get customers:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération customers",
    });
  }
});

app.get("/api/customers/nearby", (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "lat et lng requis",
      });
    }

    const customers = customerLocationManager.getNearbyCustomers(
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius),
    );

    res.json({
      success: true,
      customers,
      count: customers.length,
    });
  } catch (error) {
    console.error("Erreur get nearby customers:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération customers",
    });
  }
});

// ==================== ROUTES DRIVERS ====================

// Mettre à jour la localisation d'un chauffeur
app.post("/api/driver/location/update", async (req, res) => {
  try {
    const { driverId, location, heading, status } = req.body;

    if (!driverId || !location) {
      return res.status(400).json({
        success: false,
        message: "driverId et location requis",
      });
    }

    const result = driverLocationManager.updateDriverLocation(
      driverId,
      location,
      heading,
      status || "online",
    );

    res.json(result);
  } catch (error) {
    console.error("Erreur update location driver:", error);
    res.status(500).json({
      success: false,
      message: "Erreur mise à jour location",
    });
  }
});

// Récupérer tous les chauffeurs en ligne
app.get("/api/drivers/online", (req, res) => {
  try {
    const drivers = driverLocationManager.getOnlineDrivers();
    res.json({
      success: true,
      drivers,
      count: drivers.length,
    });
  } catch (error) {
    console.error("Erreur get drivers:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération drivers",
    });
  }
});

// Récupérer la position d'un chauffeur spécifique
app.get("/api/driver/location/:driverId", (req, res) => {
  try {
    const { driverId } = req.params;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: "driverId requis",
      });
    }

    const driver = driverLocationManager.getDriverLocation(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Chauffeur introuvable ou hors ligne",
      });
    }

    res.json({
      success: true,
      location: {
        longitude: driver.location.lng,
        latitude: driver.location.lat,
        heading: driver.heading || 0,
      },
      status: driver.status,
      lastUpdate: driver.lastUpdate,
    });
  } catch (error) {
    console.error("Erreur get driver location:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération position",
    });
  }
});

// Récupérer les chauffeurs à proximité
app.get("/api/drivers/nearby", (req, res) => {
  try {
    const { lat, lng, radius = 5 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "lat et lng requis",
      });
    }

    const drivers = driverLocationManager.getNearbyDrivers(
      parseFloat(lat),
      parseFloat(lng),
      parseFloat(radius),
    );

    res.json({
      success: true,
      drivers,
      count: drivers.length,
    });
  } catch (error) {
    console.error("Erreur get nearby drivers:", error);
    res.status(500).json({
      success: false,
      message: "Erreur récupération drivers",
    });
  }
});

// Mettre un chauffeur offline
app.post("/api/driver/offline", async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: "driverId requis",
      });
    }

    const result = driverLocationManager.setDriverOffline(driverId);
    res.json(result);
  } catch (error) {
    console.error("Erreur set driver offline:", error);
    res.status(500).json({
      success: false,
      message: "Erreur",
    });
  }
});

// ==================== ROUTES ADMIN ====================

// Upload photo de profil (base64 stocké dans Firestore)
app.post("/api/user/upload-profile-photo", async (req, res) => {
  try {
    const { uid, imageBase64 } = req.body;

    if (!uid || !imageBase64) {
      return res.status(400).json({
        success: false,
        message: "UID et image requis",
      });
    }

    // Stocker l'image en base64 directement dans Firestore
    // Format: data:image/jpeg;base64,{base64string}
    const photoUrl = `data:image/jpeg;base64,${imageBase64}`;

    // Mettre à jour Firestore
    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);

    await userRef.update({
      photoUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Photo uploadée pour ${uid} (${imageBase64.length} bytes)`);

    res.json({
      success: true,
      photoUrl,
      message: "Photo uploadée",
    });
  } catch (error) {
    console.error("Erreur upload photo:", error);
    res.status(500).json({
      success: false,
      message: "Erreur upload photo",
    });
  }
});

// Mettre à jour le profil utilisateur
app.post("/api/user/update-profile", async (req, res) => {
  try {
    const { uid, photoUrl, ...otherData } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "UID requis",
      });
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);

    const updateData = {
      ...otherData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (photoUrl) {
      updateData.photoUrl = photoUrl;
    }

    await userRef.update(updateData);

    console.log(`✅ Profil mis à jour pour ${uid}`);

    res.json({
      success: true,
      message: "Profil mis à jour",
    });
  } catch (error) {
    console.error("Erreur mise à jour profil:", error);
    res.status(500).json({
      success: false,
      message: "Erreur mise à jour profil",
    });
  }
});

// Rechercher un utilisateur par numéro de téléphone
app.post("/api/admin/search-user", async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone requis",
      });
    }

    console.log(`🔍 Recherche utilisateur: ${phoneNumber}`);

    // Rechercher dans Firebase Auth
    const userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);

    res.json({
      success: true,
      user: {
        uid: userRecord.uid,
        phoneNumber: userRecord.phoneNumber,
        displayName: userRecord.displayName || null,
      },
    });
  } catch (error) {
    console.error("Erreur recherche utilisateur:", error);
    res.status(404).json({
      success: false,
      message: "Utilisateur non trouvé",
    });
  }
});

// Ajouter des fonds (ADMIN ONLY - ARGENT RÉEL)
app.post("/api/admin/add-funds", async (req, res) => {
  try {
    const { userId, amount, reason, adminAction } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "userId et amount valide requis",
      });
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Raison requise pour l'ajout de fonds",
      });
    }

    console.log(`💰 ADMIN: Ajout de ${amount} XOF au wallet de ${userId}`);
    console.log(`📝 Raison: ${reason}`);

    const result = await walletManager.addFunds(
      userId,
      amount,
      "admin_deposit",
      {
        reason: reason,
        adminAction: true,
        timestamp: Date.now(),
        source: "admin_panel",
      },
    );

    if (result.success) {
      console.log(
        `✅ Fonds ajoutés avec succès! Nouveau solde: ${result.balance} XOF`,
      );
    }

    res.json(result);
  } catch (error) {
    console.error("Erreur ajout fonds admin:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ==================== ROUTES WALLET ====================

// TEST ONLY - Ajouter des fonds manuellement (à supprimer en production)
app.post("/api/wallet/test-add-funds", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: "userId et amount requis",
      });
    }

    console.log(`🧪 TEST: Ajout de ${amount} XOF au wallet de ${userId}`);

    const result = await walletManager.addFunds(
      userId,
      amount,
      "test_deposit",
      {
        source: "manual_test",
        timestamp: Date.now(),
      },
    );

    res.json(result);
  } catch (error) {
    console.error("Erreur test ajout fonds:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Accepter les conditions du wallet
app.post("/api/wallet/accept-terms", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId requis",
      });
    }

    const result = await walletManager.acceptTerms(userId);
    res.json(result);
  } catch (error) {
    console.error("Erreur acceptation conditions:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Récupérer le solde du wallet
app.get("/api/wallet/balance/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await walletManager.getBalance(userId);
    res.json(result);
  } catch (error) {
    console.error("Erreur récupération balance:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      balance: 0,
    });
  }
});

// Ajouter des fonds
app.post("/api/wallet/add-funds", async (req, res) => {
  try {
    const { userId, amount, metadata } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "userId et amount valide requis",
      });
    }

    const result = await walletManager.addFunds(
      userId,
      amount,
      "deposit",
      metadata,
    );
    res.json(result);
  } catch (error) {
    console.error("Erreur ajout fonds:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Déduire des fonds
app.post("/api/wallet/deduct-funds", async (req, res) => {
  try {
    const { userId, amount, metadata } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "userId et amount valide requis",
      });
    }

    const result = await walletManager.deductFunds(
      userId,
      amount,
      "payment",
      metadata,
    );
    res.json(result);
  } catch (error) {
    console.error("Erreur déduction fonds:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Récupérer l'historique des transactions
app.get("/api/wallet/transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const result = await walletManager.getTransactions(userId, limit);
    res.json(result);
  } catch (error) {
    console.error("Erreur récupération transactions:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      transactions: [],
    });
  }
});

// Récupérer les dettes d'un chauffeur
app.get("/api/wallet/driver-debts/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    const debtsSnapshot = await admin
      .firestore()
      .collection("driver_debts")
      .where("driverId", "==", driverId)
      .where("status", "==", "pending")
      .orderBy("createdAt", "desc")
      .get();

    const debts = [];
    let totalDebt = 0;

    debtsSnapshot.forEach((doc) => {
      const debtData = doc.data();
      debts.push({
        id: doc.id,
        ...debtData,
      });
      totalDebt += debtData.amount;
    });

    res.json({
      success: true,
      debts,
      totalDebt,
    });
  } catch (error) {
    console.error("Erreur récupération dettes:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      debts: [],
      totalDebt: 0,
    });
  }
});

// Récupérer les temps d'activité d'un chauffeur
app.get("/api/wallet/driver-times/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const { period = "week" } = req.query;

    const timeTracker = require("./drivers/driver-time-tracker");

    if (period === "week") {
      // Calculer le début de la semaine actuelle (lundi)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Si dimanche, reculer de 6 jours
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);

      const weeklyTimes = await timeTracker.getWeeklyTimes(driverId, weekStart);
      const totalTimes = await timeTracker.getTimesForPeriod(
        driverId,
        weekStart,
        new Date(),
      );

      res.json({
        success: true,
        weeklyTimes,
        totalTimes,
      });
    } else {
      // Pour le mois
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const totalTimes = await timeTracker.getTimesForPeriod(
        driverId,
        monthStart,
        new Date(),
      );

      res.json({
        success: true,
        totalTimes,
      });
    }
  } catch (error) {
    console.error("Erreur récupération temps:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// ==================== ROUTES PAYTECH ====================

// Créer une demande de paiement PayTech
app.post("/api/payment/paytech/create", async (req, res) => {
  try {
    const { userId, amount, phoneNumber, paymentMethod } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "userId et amount valide requis",
      });
    }

    // Si un numéro de téléphone est fourni, utiliser le paiement mobile
    let result;
    if (phoneNumber && paymentMethod) {
      result = await payTechManager.createMobilePayment(
        userId,
        amount,
        phoneNumber,
        paymentMethod,
      );
    } else {
      result = await payTechManager.createPaymentRequest(userId, amount);
    }

    // Stocker la correspondance reference -> token PayTech en mémoire
    if (result.success && result.token && result.reference) {
      global.paytechTokens = global.paytechTokens || {};
      global.paytechTokens[result.reference] = {
        paytechToken: result.token,
        userId: userId,
        amount: amount,
        createdAt: Date.now(),
      };
      console.log(`💾 Stocké: ${result.reference} -> ${result.token}`);
    }

    res.json(result);
  } catch (error) {
    console.error("Erreur création paiement PayTech:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Vérifier le statut d'un paiement PayTech
app.post("/api/payment/paytech/check", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "token requis",
      });
    }

    console.log(`🔍 Vérification paiement pour token: ${token}`);

    // Vérifier si c'est notre référence (WODI_...) ou le token PayTech
    let paytechToken = token;
    let paymentInfo = null;

    if (token.startsWith("WODI_")) {
      // C'est notre référence, récupérer le token PayTech
      global.paytechTokens = global.paytechTokens || {};
      paymentInfo = global.paytechTokens[token];

      if (paymentInfo) {
        paytechToken = paymentInfo.paytechToken;
        console.log(`🔄 Référence WODI convertie: ${token} -> ${paytechToken}`);
      } else {
        console.log(`⚠️ Référence WODI non trouvée: ${token}`);
        return res.json({
          success: false,
          message:
            "Référence de paiement non trouvée. Le paiement a peut-être expiré.",
        });
      }
    }

    const result = await payTechManager.checkPaymentStatus(paytechToken);

    console.log(
      "📊 Résultat vérification PayTech:",
      JSON.stringify(result, null, 2),
    );

    // Si le paiement est complété, ajouter les fonds au wallet
    if (result.success && result.data) {
      const { type_event, custom_field, item_price } = result.data;

      console.log(`📋 Type event: ${type_event}`);
      console.log(`📋 Custom field: ${custom_field}`);
      console.log(`📋 Item price: ${item_price}`);

      if (type_event === "sale_complete") {
        try {
          const customData = JSON.parse(custom_field || "{}");
          const userId = customData.userId;
          const amount = parseFloat(item_price);

          console.log(
            `💰 Tentative ajout de ${amount} XOF au wallet de ${userId}`,
          );

          if (!userId) {
            console.error("❌ userId manquant dans custom_field");
            return res.json({
              ...result,
              fundsAdded: false,
              error: "userId manquant",
            });
          }

          // Ajouter les fonds
          const addFundsResult = await walletManager.addFunds(
            userId,
            amount,
            "deposit",
            {
              reference: token,
              paytechToken: paytechToken,
              paymentMethod: "PayTech",
              verifiedManually: true,
            },
          );

          console.log("✅ Fonds ajoutés avec succès:", addFundsResult);

          // Nettoyer le token stocké
          if (token.startsWith("WODI_") && global.paytechTokens) {
            delete global.paytechTokens[token];
          }

          return res.json({
            ...result,
            fundsAdded: true,
            newBalance: addFundsResult.balance,
          });
        } catch (error) {
          console.error("❌ Erreur ajout fonds:", error);
          return res.json({
            ...result,
            fundsAdded: false,
            error: error.message,
          });
        }
      } else {
        console.log(`⏳ Paiement pas encore complété. Status: ${type_event}`);
      }
    } else {
      console.log("⚠️ Vérification échouée ou pas de données");
    }

    res.json(result);
  } catch (error) {
    console.error("❌ Erreur vérification paiement:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Vérifier le statut d'un paiement PayTech (GET avec token dans URL)
app.get("/api/payment/check/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "token requis",
      });
    }

    const result = await payTechManager.checkPaymentStatus(token);
    res.json(result);
  } catch (error) {
    console.error("Erreur vérification paiement:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// IPN (Instant Payment Notification) de PayTech
app.post("/api/payment/paytech/ipn", async (req, res) => {
  try {
    console.log("📥 IPN PayTech reçu:", req.body);

    const ipnResult = await payTechManager.processIPN(req.body);

    if (ipnResult.success && ipnResult.status === "completed") {
      // Ajouter les fonds au wallet
      const addFundsResult = await walletManager.addFunds(
        ipnResult.userId,
        ipnResult.amount,
        "paytech_recharge",
        {
          reference: ipnResult.reference,
          paymentMethod: "PayTech",
          ipnData: req.body,
        },
      );

      console.log("✅ Fonds ajoutés:", addFundsResult);
    }

    // Toujours répondre 200 OK à PayTech
    res.status(200).send("OK");
  } catch (error) {
    console.error("Erreur traitement IPN:", error);
    res.status(200).send("OK"); // Toujours répondre OK même en cas d'erreur
  }
});

// Callback de succès PayTech
app.get("/api/payment/success", async (req, res) => {
  try {
    const { token } = req.query;
    console.log("✅ Paiement réussi - Token:", token);

    // Si c'est une référence WODI, ajouter les fonds immédiatement
    if (token && token.startsWith("WODI_")) {
      global.paytechTokens = global.paytechTokens || {};
      const paymentInfo = global.paytechTokens[token];

      if (paymentInfo) {
        console.log(
          `💰 Ajout automatique de ${paymentInfo.amount} XOF au wallet de ${paymentInfo.userId}`,
        );

        try {
          const addFundsResult = await walletManager.addFunds(
            paymentInfo.userId,
            paymentInfo.amount,
            "deposit",
            {
              reference: token,
              paytechToken: paymentInfo.paytechToken,
              paymentMethod: "PayTech",
              autoAdded: true,
            },
          );

          console.log("✅ Fonds ajoutés automatiquement:", addFundsResult);

          // Nettoyer le token
          delete global.paytechTokens[token];
        } catch (error) {
          console.error("❌ Erreur ajout fonds:", error);
        }
      }
    }

    // Rediriger vers une page HTML simple qui ferme la WebView
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Paiement réussi</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 20px;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            margin: 0 0 10px 0;
            font-size: 28px;
          }
          p {
            margin: 0;
            opacity: 0.9;
            font-size: 16px;
          }
          .close-info {
            margin-top: 20px;
            font-size: 14px;
            opacity: 0.7;
          }
        </style>
        <script>
          // Essayer de fermer la WebView après 2 secondes
          setTimeout(() => {
            window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'success', token: '${token}' }));
          }, 2000);
        </script>
      </head>
      <body>
        <div class="container">
          <div class="icon">✅</div>
          <h1>Paiement réussi!</h1>
          <p>Votre rechargement a été effectué avec succès.</p>
          <p class="close-info">Cette fenêtre va se fermer automatiquement...</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Erreur callback succès:", error);
    res.status(500).send("Erreur");
  }
});

// Callback d'annulation PayTech
app.get("/api/payment/cancel", async (req, res) => {
  try {
    const { token } = req.query;
    console.log("❌ Paiement annulé - Token:", token);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Paiement annulé</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            text-align: center;
            padding: 20px;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          }
          .icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            margin: 0 0 10px 0;
            font-size: 28px;
          }
          p {
            margin: 0;
            opacity: 0.9;
            font-size: 16px;
          }
          .close-info {
            margin-top: 20px;
            font-size: 14px;
            opacity: 0.7;
          }
        </style>
        <script>
          setTimeout(() => {
            window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'cancel', token: '${token}' }));
          }, 2000);
        </script>
      </head>
      <body>
        <div class="container">
          <div class="icon">❌</div>
          <h1>Paiement annulé</h1>
          <p>Vous avez annulé le paiement.</p>
          <p class="close-info">Cette fenêtre va se fermer automatiquement...</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Erreur callback annulation:", error);
    res.status(500).send("Erreur");
  }
});

// ==================== ROUTES RIDE BOOKING ====================

// Calculer le prix d'une course
app.post("/api/ride/calculate-price", async (req, res) => {
  try {
    const { fromLat, fromLng, toLat, toLng } = req.body;

    if (!fromLat || !fromLng || !toLat || !toLng) {
      return res.status(400).json({
        success: false,
        message: "Coordonnées de départ et d'arrivée requises",
      });
    }

    const result = priceCalculator.calculateAllPrices(
      fromLat,
      fromLng,
      toLat,
      toLng,
    );

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Erreur calcul prix:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// Réserver une course
app.post("/api/ride/book", async (req, res) => {
  try {
    const {
      userId,
      fromLat,
      fromLng,
      toLat,
      toLng,
      fromAddress,
      toAddress,
      vehicleType,
      paymentMethod,
    } = req.body;

    if (
      !userId ||
      !fromLat ||
      !fromLng ||
      !toLat ||
      !toLng ||
      !vehicleType ||
      !paymentMethod
    ) {
      return res.status(400).json({
        success: false,
        message: "Données de réservation incomplètes",
      });
    }

    // Calculer le prix
    const priceData = priceCalculator.calculateAllPrices(
      fromLat,
      fromLng,
      toLat,
      toLng,
    );
    const vehiclePrice = priceData.prices[vehicleType];

    if (!vehiclePrice) {
      return res.status(400).json({
        success: false,
        message: "Type de véhicule invalide",
      });
    }

    // Si paiement par wallet, vérifier et déduire les fonds
    if (paymentMethod === "wallet") {
      const deductResult = await walletManager.deductFunds(
        userId,
        vehiclePrice.price,
        "ride_payment",
        {
          vehicleType: vehicleType,
          distance: priceData.distance,
          from: fromAddress,
          to: toAddress,
        },
      );

      if (!deductResult.success) {
        return res.status(400).json({
          success: false,
          message: "Solde insuffisant",
        });
      }
    }

    // Créer la réservation dans Firestore
    const rideRef = await admin
      .firestore()
      .collection("rides")
      .add({
        userId: userId,
        from: {
          latitude: fromLat,
          longitude: fromLng,
          address: fromAddress || "",
        },
        to: {
          latitude: toLat,
          longitude: toLng,
          address: toAddress || "",
        },
        vehicleType: vehicleType,
        price: vehiclePrice.price,
        distance: priceData.distance,
        estimatedDuration: priceData.estimatedDuration,
        paymentMethod: paymentMethod,
        status: "pending", // pending, accepted, in_progress, completed, cancelled
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    res.json({
      success: true,
      rideId: rideRef.id,
      price: vehiclePrice.price,
      distance: priceData.distance,
      estimatedDuration: priceData.estimatedDuration,
    });
  } catch (error) {
    console.error("Erreur réservation course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Serveur OTP démarré sur le port ${PORT}`);
  console.log(`📱 Accessible sur:`);
  console.log(`   - Localhost: http://localhost:${PORT}`);
  console.log(`   - Réseau local: http://192.168.100.71:${PORT}`);
  console.log(`   - Émulateur Android: http://10.0.2.2:${PORT}`);
});
