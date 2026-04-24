const express = require("express");
const router = express.Router();
const admin = require("../config/firebase-admin");

// GET - Récupérer la politique de prix actuelle
router.get("/get", async (req, res) => {
  try {
    const db = admin.database();
    const snapshot = await db.ref("settings/pricing").once("value");
    const data = snapshot.val();

    if (data) {
      res.json({
        success: true,
        pricing: data,
      });
    } else {
      // Retourner les prix par défaut
      const DEFAULT_PRICING = {
        yaris: {
          name: "yaris",
          displayName: "Yaris",
          basePrice: 500,
          pricePerKm: 250,
          minPrice: 1000,
          eco: true,
          icon: "🌿",
          image: "yaris.png",
        },
        berline: {
          name: "berline",
          displayName: "Berline",
          basePrice: 800,
          pricePerKm: 300,
          minPrice: 1500,
          eco: false,
          icon: "🚗",
          image: "berline.png",
        },
        suv: {
          name: "suv",
          displayName: "SUV",
          basePrice: 1200,
          pricePerKm: 400,
          minPrice: 2000,
          eco: false,
          icon: "🚙",
          image: "suv.png",
        },
      };

      res.json({
        success: true,
        pricing: DEFAULT_PRICING,
      });
    }
  } catch (error) {
    console.error("Erreur récupération pricing:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

// POST - Mettre à jour la politique de prix
router.post("/update", async (req, res) => {
  try {
    const { pricing } = req.body;

    if (!pricing) {
      return res.status(400).json({
        success: false,
        message: "Données de pricing manquantes",
      });
    }

    const db = admin.database();
    await db.ref("settings/pricing").set(pricing);

    console.log("💾 Prix sauvegardés dans Realtime Database");
    console.log("🔄 Le listener mettra à jour automatiquement le calculateur");

    res.json({
      success: true,
      message: "Prix mis à jour avec succès",
    });
  } catch (error) {
    console.error("Erreur mise à jour pricing:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

module.exports = router;
