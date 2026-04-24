const express = require("express");
const router = express.Router();
const RealtimeRideManager = require("../ride/realtime-ride-manager");
const DriverLocationManager = require("../drivers/driver-location-manager");
const { priceCalculator } = require("../shared-instances");
const admin = require("../config/firebase-admin");

// Calculer le prix pour tous les types de véhicules
router.post("/calculate-price", async (req, res) => {
  try {
    const { fromLat, fromLng, toLat, toLng } = req.body;

    if (!fromLat || !fromLng || !toLat || !toLng) {
      return res.status(400).json({
        success: false,
        message: "Coordonnées manquantes",
      });
    }

    // Calculer la distance
    const distance = priceCalculator.calculateDistance(
      fromLat,
      fromLng,
      toLat,
      toLng,
    );

    // Calculer le prix pour chaque type de véhicule
    const prices = {};
    const vehicleTypes = ["yaris", "berline", "suv"];

    for (const vehicleType of vehicleTypes) {
      const pricing = priceCalculator.calculatePrice(distance, vehicleType);
      prices[vehicleType] = pricing;
    }

    // Calculer la durée estimée (vitesse moyenne 30 km/h en ville)
    const duration = Math.round((distance / 30) * 3600); // en secondes

    return res.json({
      success: true,
      distance: Math.round(distance * 1000), // en mètres
      duration,
      prices,
    });
  } catch (error) {
    console.error("Erreur calcul prix:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors du calcul du prix",
    });
  }
});

// Créer une demande de course
router.post("/request", async (req, res) => {
  try {
    const { customerId, pickup, destination, vehicleType, promoId } = req.body;

    // Valider les données
    if (!customerId || !pickup || !destination || !vehicleType) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer les infos du client depuis Firebase
    const customerDoc = await admin
      .firestore()
      .collection("users")
      .doc(customerId)
      .get();
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable",
      });
    }

    const customerData = customerDoc.data();

    // Calculer la distance
    const distance = priceCalculator.calculateDistance(
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude,
    );

    // Calculer le prix
    const pricing = priceCalculator.calculatePrice(distance, vehicleType);
    let finalPrice = pricing.price;
    let discountAmount = 0;
    let appliedPromo = null;

    // Appliquer la promo si présente
    if (promoId) {
      try {
        const promoSnapshot = await admin
          .database()
          .ref(`ride_promotions/${promoId}`)
          .once("value");

        if (promoSnapshot.exists()) {
          const promo = promoSnapshot.val();
          const now = Date.now();

          // Vérifier si la promo est valide
          if (
            promo.active &&
            now >= promo.startDate &&
            now <= promo.endDate &&
            (!promo.maxUsage || promo.usageCount < promo.maxUsage) &&
            (!promo.minRidePrice || pricing.price >= promo.minRidePrice)
          ) {
            // Calculer la réduction
            discountAmount = Math.round((pricing.price * promo.discount) / 100);

            // Appliquer la réduction maximale si définie
            if (promo.maxDiscount && discountAmount > promo.maxDiscount) {
              discountAmount = promo.maxDiscount;
            }

            finalPrice = pricing.price - discountAmount;
            appliedPromo = {
              id: promoId,
              code: promo.code,
              discount: promo.discount,
              discountAmount,
            };

            console.log(
              `[RideRequest] 🎉 Promo ${promo.code} appliquée: -${discountAmount} FCFA`,
            );
          }
        }
      } catch (error) {
        console.error("[RideRequest] Erreur application promo:", error);
      }
    }

    // Trouver les chauffeurs proches
    const nearbyDrivers = DriverLocationManager.findNearbyDrivers(
      pickup.latitude,
      pickup.longitude,
      5000, // 5km
      5, // max 5 chauffeurs
    );

    const notifiedDriverIds = nearbyDrivers.map((d) => d.id);

    // Calculer les montants avec la promo appliquée
    const wodiCommission = Math.round(finalPrice * 0.1); // 10% commission
    const driverEarning = Math.round(finalPrice * 0.9); // 90% pour le chauffeur

    // Créer la course dans Realtime DB
    const result = await RealtimeRideManager.createRide({
      customerId,
      customerName:
        `${customerData.firstName || ""} ${customerData.lastName || ""}`.trim(),
      customerPhone: customerData.phoneNumber,
      customerPhoto: customerData.photoURL || null,
      pickup,
      destination,
      vehicleType,
      price: finalPrice,
      originalPrice: pricing.price,
      discountAmount,
      appliedPromo,
      distance: pricing.distance,
      duration: pricing.duration,
      wodiCommission,
      driverEarning,
      notifiedDrivers: notifiedDriverIds,
    });

    if (!result.success) {
      return res.status(500).json(result);
    }

    // Si une promo a été appliquée, incrémenter son utilisation
    if (appliedPromo) {
      try {
        // Incrémenter le compteur global
        await admin
          .database()
          .ref(`ride_promotions/${promoId}/usageCount`)
          .transaction((current) => (current || 0) + 1);

        // Incrémenter le compteur utilisateur
        await admin
          .database()
          .ref(`user_promo_usage/${customerId}/${promoId}`)
          .transaction((current) => (current || 0) + 1);

        // Désactiver la promo active de l'utilisateur
        await admin.database().ref(`user_active_promo/${customerId}`).set(null);

        console.log(
          `[RideRequest] ✅ Utilisation promo incrémentée pour ${customerId}`,
        );
      } catch (error) {
        console.error("[RideRequest] Erreur incrémentation promo:", error);
      }
    }

    console.log(
      `[RideRequest] ✅ Course ${result.rideId} créée, ${notifiedDriverIds.length} chauffeurs notifiés`,
    );

    res.json({
      success: true,
      ride: {
        id: result.rideId,
        status: "searching",
        price: finalPrice,
        originalPrice: pricing.price,
        discountAmount,
        appliedPromo,
        distance: pricing.distance,
        duration: pricing.duration,
      },
      driversNotified: notifiedDriverIds.length,
    });
  } catch (error) {
    console.error("Erreur création course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Chauffeur accepte une course
router.post("/accept", async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer les infos du chauffeur
    const driverDoc = await admin
      .firestore()
      .collection("users")
      .doc(driverId)
      .get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "Chauffeur introuvable",
      });
    }

    const driverData = driverDoc.data();

    const result = await RealtimeRideManager.acceptRide(rideId, driverId, {
      name: `${driverData.firstName || ""} ${driverData.lastName || ""}`.trim(),
      phone: driverData.phoneNumber,
      photo: driverData.photoURL || null,
      vehicle: {
        type: driverData.vehicleType,
        model: driverData.vehicleModel,
        plate: driverData.vehiclePlate,
        color: driverData.vehicleColor,
      },
      rating: driverData.rating || 5.0,
      ratingCount: driverData.ratingCount || 0,
    });

    res.json(result);
  } catch (error) {
    console.error("Erreur acceptation course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Chauffeur commence le trajet vers le client
router.post("/start-pickup", async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    // Cette route n'est plus nécessaire avec le nouveau système
    // Le statut change automatiquement quand le chauffeur accepte
    res.json({ success: true, message: "Démarrage automatique" });
  } catch (error) {
    console.error("Erreur démarrage pickup:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Chauffeur confirme que le client est dans la voiture
router.post("/confirm-pickup", async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    const result = await RealtimeRideManager.confirmPickup(rideId, driverId);
    res.json(result);
  } catch (error) {
    console.error("Erreur confirmation pickup:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Chauffeur termine la course
router.post("/complete", async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    const result = await RealtimeRideManager.completeRide(rideId, driverId);

    res.json(result);
  } catch (error) {
    console.error("Erreur fin course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Paiement en cash - Driver confirme réception
router.post("/pay-cash", async (req, res) => {
  try {
    const { rideId, driverId } = req.body;

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    const rideResult = await RealtimeRideManager.getRide(rideId);
    if (!rideResult.success) {
      return res.status(404).json({
        success: false,
        message: "Course introuvable",
      });
    }

    const ride = rideResult.ride;

    // Créer dette pour le driver (commission WODI)
    await admin
      .firestore()
      .collection("driver_debts")
      .add({
        driverId: driverId,
        amount: ride.wodiCommission,
        rideId: rideId,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dueDate: admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
        ),
      });

    // Marquer comme payé
    await RealtimeRideManager.ridesRef.child(rideId).update({
      paymentStatus: "completed",
      paymentMethod: "cash",
      paidAt: Date.now(),
    });

    console.log(
      `[PayCash] ✅ Paiement cash confirmé - Dette créée: ${ride.wodiCommission} XOF`,
    );

    res.json({
      success: true,
      breakdown: {
        total: ride.price,
        driverReceived: ride.price,
        driverKeeps: ride.driverEarning,
        wodiCommission: ride.wodiCommission,
      },
    });
  } catch (error) {
    console.error("Erreur paiement cash:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Paiement par wallet - Client paie
router.post("/pay-wallet", async (req, res) => {
  try {
    const { rideId, customerId } = req.body;

    if (!rideId || !customerId) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    const rideResult = await RealtimeRideManager.getRide(rideId);
    if (!rideResult.success) {
      return res.status(404).json({
        success: false,
        message: "Course introuvable",
      });
    }

    const ride = rideResult.ride;

    console.log(
      `[PayWallet] 💳 Paiement wallet - Client: ${customerId}, Montant: ${ride.price} XOF`,
    );

    // 1. Déduire du wallet client
    const WalletManager = require("../wallet/wallet-manager");
    const walletManager = new WalletManager(); // Instancier la classe

    const deductResult = await walletManager.deductFunds(
      customerId,
      ride.price,
      "ride_payment",
      {
        rideId: rideId,
        driverId: ride.takenBy,
        vehicleType: ride.vehicleType,
      },
    );

    if (!deductResult.success) {
      console.error(`[PayWallet] ❌ Échec déduction: ${deductResult.message}`);
      return res.json({
        success: false,
        message: deductResult.message || "Solde insuffisant",
      });
    }

    console.log(
      `[PayWallet] ✅ Déduction client réussie - Nouveau solde: ${deductResult.balance} XOF`,
    );

    // 2. Ajouter au wallet driver (85%)
    const addResult = await walletManager.addFunds(
      ride.takenBy,
      ride.driverEarning,
      "ride_earning",
      {
        rideId: rideId,
        customerId: customerId,
        vehicleType: ride.vehicleType,
      },
    );

    console.log(
      `[PayWallet] ✅ Ajout driver réussi - Montant: ${ride.driverEarning} XOF`,
    );

    // 3. Créer crédit WODI (10%)
    await admin.firestore().collection("wodi_credits").add({
      amount: ride.wodiCommission,
      rideId: rideId,
      customerId: customerId,
      driverId: ride.takenBy,
      source: "wallet_payment",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[PayWallet] ✅ Crédit WODI créé - Montant: ${ride.wodiCommission} XOF`,
    );

    // 4. Marquer comme payé
    await RealtimeRideManager.ridesRef.child(rideId).update({
      paymentStatus: "completed",
      paymentMethod: "wallet",
      paidAt: Date.now(),
    });

    res.json({
      success: true,
      breakdown: {
        total: ride.price,
        driverEarning: ride.driverEarning,
        wodiCommission: ride.wodiCommission,
        customerNewBalance: deductResult.balance,
        driverNewBalance: addResult.balance,
      },
    });
  } catch (error) {
    console.error("Erreur paiement wallet:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Annuler une course
router.post("/cancel", async (req, res) => {
  try {
    const { rideId, userId, userType } = req.body;

    if (!rideId || !userId || !userType) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    const result = await RealtimeRideManager.cancelRide(
      rideId,
      userId,
      userType,
    );

    res.json(result);
  } catch (error) {
    console.error("Erreur annulation course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Noter le chauffeur
router.post("/rate", async (req, res) => {
  try {
    const { rideId, customerId, rating, review } = req.body;

    if (!rideId || !customerId || !rating) {
      return res.status(400).json({
        success: false,
        message: "Données manquantes",
      });
    }

    // Récupérer la course depuis Realtime DB
    const rideResult = await RealtimeRideManager.getRide(rideId);

    if (!rideResult.success) {
      return res.status(404).json({
        success: false,
        message: "Course introuvable",
      });
    }

    const ride = rideResult.ride;

    // Mettre à jour dans Realtime Database
    await RealtimeRideManager.ridesRef.child(rideId).update({
      rating,
      review: review || null,
      rated: true,
      ratedAt: Date.now(),
    });

    // Mettre à jour la note moyenne du chauffeur
    if (ride.takenBy) {
      const driverRef = admin.firestore().collection("users").doc(ride.takenBy);
      const driverDoc = await driverRef.get();

      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        const currentRating = driverData.rating || 0;
        const currentRatingCount = driverData.ratingCount || 0;

        const newRatingCount = currentRatingCount + 1;
        const newRating =
          (currentRating * currentRatingCount + rating) / newRatingCount;

        await driverRef.update({
          rating: newRating,
          ratingCount: newRatingCount,
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Erreur notation:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Obtenir les détails d'une course
router.get("/:rideId", async (req, res) => {
  try {
    const { rideId } = req.params;

    const result = await RealtimeRideManager.getRide(rideId);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: "Course introuvable",
      });
    }

    res.json({
      success: true,
      ride: result.ride,
    });
  } catch (error) {
    console.error("Erreur récupération course:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Obtenir l'historique des courses d'un utilisateur
router.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20 } = req.query;

    // Récupérer depuis Realtime Database
    const ridesSnapshot = await admin.database().ref("rides").once("value");
    const ridesData = ridesSnapshot.val() || {};

    // Convertir en tableau et filtrer par userId
    const rides = Object.entries(ridesData)
      .map(([id, ride]) => ({ id, ...ride }))
      .filter((ride) => ride.customerId === userId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, parseInt(limit));

    res.json({
      success: true,
      rides,
    });
  } catch (error) {
    console.error("Erreur historique:", error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message,
    });
  }
});

// Vérifier s'il y a une demande en attente pour ce chauffeur
router.get("/pending/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    // Récupérer les courses en recherche pour ce chauffeur
    const result = await RealtimeRideManager.getSearchingRides(driverId);

    if (result.success && result.rides.length > 0) {
      // Retourner la première course trouvée
      const ride = result.rides[0];
      return res.json({
        success: true,
        request: {
          id: ride.id,
          customerName: ride.customerName,
          customerPhoto: ride.customerPhoto,
          pickup: ride.pickup,
          destination: ride.destination,
          price: ride.price,
          driverEarning: ride.driverEarning,
          wodiCommission: ride.wodiCommission,
          distance: ride.distance,
          duration: ride.duration,
          distanceToPickup: 0, // TODO: calculer
          expiresAt: ride.expiresAt,
        },
      });
    }

    return res.json({
      success: true,
      request: null,
    });
  } catch (error) {
    console.error("Erreur récupération demande:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération de la demande",
    });
  }
});

module.exports = router;
