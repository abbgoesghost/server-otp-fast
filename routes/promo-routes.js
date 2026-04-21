const express = require("express");
const router = express.Router();
const admin = require("../config/firebase-admin");

/**
 * Créer une promo dans Realtime DB
 */
router.post("/create", async (req, res) => {
  try {
    const { promoId, data } = req.body;

    if (!promoId || !data) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Écrire dans Realtime DB
    await admin.database().ref(`ride_promotions/${promoId}`).set(data);

    console.log(`[Promo] ✅ Promo ${promoId} créée dans Realtime DB`);

    return res.json({
      success: true,
      promoId,
    });
  } catch (error) {
    console.error("[Promo] Erreur création:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

/**
 * Mettre à jour une promo dans Realtime DB
 */
router.post("/update", async (req, res) => {
  try {
    const { promoId, data } = req.body;

    if (!promoId || !data) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Mettre à jour dans Realtime DB
    await admin.database().ref(`ride_promotions/${promoId}`).update(data);

    console.log(`[Promo] ✅ Promo ${promoId} mise à jour dans Realtime DB`);

    return res.json({
      success: true,
      promoId,
    });
  } catch (error) {
    console.error("[Promo] Erreur mise à jour:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

/**
 * Supprimer une promo de Realtime DB
 */
router.post("/delete", async (req, res) => {
  try {
    const { promoId } = req.body;

    if (!promoId) {
      return res.status(400).json({
        success: false,
        message: "PromoId manquant",
      });
    }

    // Supprimer de Realtime DB
    await admin.database().ref(`ride_promotions/${promoId}`).remove();

    console.log(`[Promo] ✅ Promo ${promoId} supprimée de Realtime DB`);

    return res.json({
      success: true,
      promoId,
    });
  } catch (error) {
    console.error("[Promo] Erreur suppression:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

/**
 * Valider et appliquer une promo à une course
 */
router.post("/validate-ride-promo", async (req, res) => {
  try {
    const { userId, promoId, ridePrice } = req.body;

    if (!userId || !promoId || !ridePrice) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer la promo depuis Realtime DB
    const promoSnapshot = await admin
      .database()
      .ref(`ride_promotions/${promoId}`)
      .once("value");

    if (!promoSnapshot.exists()) {
      return res.status(404).json({
        success: false,
        message: "Promotion introuvable",
      });
    }

    const promo = promoSnapshot.val();
    const now = Date.now();

    // Vérifications
    if (!promo.active) {
      return res.json({
        success: false,
        message: "Cette promotion n'est plus active",
      });
    }

    if (now < promo.startDate) {
      return res.json({
        success: false,
        message: "Cette promotion n'a pas encore commencé",
      });
    }

    if (now > promo.endDate) {
      return res.json({
        success: false,
        message: "Cette promotion a expiré",
      });
    }

    // Vérifier la limite globale
    if (promo.maxUsage && promo.usageCount >= promo.maxUsage) {
      return res.json({
        success: false,
        message: "Cette promotion a atteint sa limite d'utilisation",
      });
    }

    // Vérifier la limite par utilisateur
    const userUsageSnapshot = await admin
      .database()
      .ref(`user_promo_usage/${userId}/${promoId}`)
      .once("value");

    const userUsageCount = userUsageSnapshot.val() || 0;

    if (userUsageCount >= promo.maxUsagePerUser) {
      return res.json({
        success: false,
        message: `Vous avez déjà utilisé ce code ${promo.maxUsagePerUser} fois`,
      });
    }

    // Vérifier le prix minimum
    if (promo.minRidePrice && ridePrice < promo.minRidePrice) {
      return res.json({
        success: false,
        message: `Prix minimum de ${promo.minRidePrice} FCFA requis`,
      });
    }

    // Calculer la réduction
    let discount = Math.round((ridePrice * promo.discount) / 100);

    // Appliquer la réduction maximale si définie
    if (promo.maxDiscount && discount > promo.maxDiscount) {
      discount = promo.maxDiscount;
    }

    const finalPrice = ridePrice - discount;

    return res.json({
      success: true,
      promo: {
        id: promoId,
        title: promo.title,
        code: promo.code,
        discount: promo.discount,
      },
      originalPrice: ridePrice,
      discountAmount: discount,
      finalPrice,
    });
  } catch (error) {
    console.error("[Promo] Erreur validation:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

/**
 * Incrémenter l'utilisation d'une promo après une course
 */
router.post("/increment-promo-usage", async (req, res) => {
  try {
    const { userId, promoId } = req.body;

    if (!userId || !promoId) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Incrémenter le compteur global
    const promoRef = admin.database().ref(`ride_promotions/${promoId}`);
    await promoRef.child("usageCount").transaction((current) => {
      return (current || 0) + 1;
    });

    // Incrémenter le compteur utilisateur
    const userUsageRef = admin
      .database()
      .ref(`user_promo_usage/${userId}/${promoId}`);
    await userUsageRef.transaction((current) => {
      return (current || 0) + 1;
    });

    // Désactiver la promo active de l'utilisateur
    await admin.database().ref(`user_active_promo/${userId}`).set(null);

    console.log(
      `[Promo] ✅ Utilisation incrémentée - User: ${userId}, Promo: ${promoId}`,
    );

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error("[Promo] Erreur incrémentation:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

/**
 * Obtenir la promo active d'un utilisateur
 */
router.get("/active-promo/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const activePromoSnapshot = await admin
      .database()
      .ref(`user_active_promo/${userId}`)
      .once("value");

    const promoId = activePromoSnapshot.val();

    if (!promoId) {
      return res.json({
        success: true,
        promo: null,
      });
    }

    // Récupérer les détails de la promo
    const promoSnapshot = await admin
      .database()
      .ref(`ride_promotions/${promoId}`)
      .once("value");

    if (!promoSnapshot.exists()) {
      return res.json({
        success: true,
        promo: null,
      });
    }

    const promo = promoSnapshot.val();

    return res.json({
      success: true,
      promo: {
        id: promoId,
        ...promo,
      },
    });
  } catch (error) {
    console.error("[Promo] Erreur récupération promo active:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur",
    });
  }
});

module.exports = router;
