const express = require("express");
const router = express.Router();
const analyticsManager = require("../analytics/analytics-manager");

/**
 * Enregistrer un utilisateur actif
 */
router.post("/track-active", async (req, res) => {
  try {
    const { userId, userType, deviceInfo } = req.body;

    if (!userId || !userType) {
      return res.status(400).json({
        success: false,
        error: "userId et userType requis",
      });
    }

    const result = await analyticsManager.trackActiveUser(
      userId,
      userType,
      deviceInfo,
    );
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur track-active:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Marquer un utilisateur comme inactif
 */
router.post("/mark-inactive", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId requis",
      });
    }

    const result = await analyticsManager.markUserInactive(userId);
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur mark-inactive:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Obtenir les statistiques globales
 */
router.get("/stats/global", async (req, res) => {
  try {
    const result = await analyticsManager.getGlobalStats();
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur stats global:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Obtenir les statistiques par période
 */
router.get("/stats/period/:period", async (req, res) => {
  try {
    const { period } = req.params; // today, week, month
    const result = await analyticsManager.getStatsByPeriod(period);
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur stats period:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Obtenir les données pour les charts
 */
router.get("/charts/:type/:period", async (req, res) => {
  try {
    const { type, period } = req.params; // type: revenue, rides, commission | period: week, month
    const result = await analyticsManager.getChartData(type, period);
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur chart data:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Obtenir les courses actives avec détails
 */
router.get("/active-rides", async (req, res) => {
  try {
    const result = await analyticsManager.getActiveRidesDetails();
    res.json(result);
  } catch (error) {
    console.error("[Analytics Routes] Erreur active rides:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

/**
 * Obtenir les statistiques détaillées avec revenus
 */
router.get("/detailed", async (req, res) => {
  try {
    const { date, period } = req.query;
    const admin = require("firebase-admin");

    const selectedDate = new Date(date);
    let startDate, endDate;

    if (period === "day") {
      startDate = new Date(selectedDate.setHours(0, 0, 0, 0));
      endDate = new Date(selectedDate.setHours(23, 59, 59, 999));
    } else if (period === "week") {
      const day = selectedDate.getDay();
      const diff = selectedDate.getDate() - day;
      startDate = new Date(selectedDate.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === "month") {
      startDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        1,
      );
      endDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    }

    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();

    // Récupérer toutes les courses depuis Firebase Realtime Database
    const ridesSnapshot = await admin.database().ref("rides").once("value");
    const ridesData = ridesSnapshot.val() || {};
    const ridesArray = Object.entries(ridesData).map(([id, ride]) => ({
      id,
      ...ride,
    }));

    // Filtrer les courses par période
    const periodRides = ridesArray.filter((ride) => {
      const rideTime = ride.createdAt || 0;
      return rideTime >= startTimestamp && rideTime <= endTimestamp;
    });

    let totalRevenue = 0;
    let commission = 0;
    let completedRides = 0;
    let cancelledRides = 0;
    let activeRides = 0;
    let totalRating = 0;
    let ratingCount = 0;

    periodRides.forEach((ride) => {
      if (ride.status === "completed") {
        completedRides++;
        totalRevenue += ride.price || 0;
        commission +=
          ride.wodiCommission || Math.round((ride.price || 0) * 0.1);
        if (ride.rating) {
          totalRating += ride.rating;
          ratingCount++;
        }
      } else if (ride.status === "cancelled") {
        cancelledRides++;
      } else if (
        ride.status === "searching" ||
        ride.status === "accepted" ||
        ride.status === "in_progress"
      ) {
        activeRides++;
      }
    });

    // Récupérer commandes e-commerce (seulement non annulées)
    const ordersSnapshot = await admin
      .firestore()
      .collection("ecommerce_orders")
      .where("createdAt", ">=", startTimestamp)
      .where("createdAt", "<=", endTimestamp)
      .get();

    let ecommerceRevenue = 0;
    let totalOrderPrice = 0;
    let nonCancelledOrders = 0;

    ordersSnapshot.forEach((doc) => {
      const order = doc.data();
      // Ne compter que les commandes non annulées
      if (order.status !== "cancelled") {
        const price = order.finalPrice || order.price || 0;
        ecommerceRevenue += price;
        totalOrderPrice += price;
        nonCancelledOrders++;
      }
    });

    // Récupérer recharges wallet
    const walletsSnapshot = await admin
      .firestore()
      .collection("wallet_transactions")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startDate))
      .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(endDate))
      .where("type", "==", "topup")
      .get();

    let walletTopups = 0;
    walletsSnapshot.forEach((doc) => {
      const transaction = doc.data();
      walletTopups += transaction.amount || 0;
    });

    // Compter utilisateurs actifs
    const usersSnapshot = await admin.firestore().collection("users").get();

    let activeCustomers = 0;
    let activeDrivers = 0;
    let totalUsers = 0;

    usersSnapshot.forEach((doc) => {
      const user = doc.data();
      totalUsers++;
      if (user.userType === "customer") {
        activeCustomers++;
      } else if (user.userType === "driver") {
        activeDrivers++;
      }
    });

    const totalRides = completedRides + cancelledRides + activeRides;
    const completionRate =
      totalRides > 0 ? Math.round((completedRides / totalRides) * 100) : 0;
    const cancellationRate =
      totalRides > 0 ? Math.round((cancelledRides / totalRides) * 100) : 0;
    const avgRating =
      ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : 0;
    const avgRidePrice =
      completedRides > 0 ? Math.round(totalRevenue / completedRides) : 0;
    const avgOrderPrice =
      nonCancelledOrders > 0
        ? Math.round(totalOrderPrice / nonCancelledOrders)
        : 0;

    console.log(
      `[Analytics] 📊 Stats détaillées - Période: ${period}, Courses: ${totalRides}, Revenus: ${totalRevenue + ecommerceRevenue + walletTopups} FCFA`,
    );

    res.json({
      success: true,
      stats: {
        totalRevenue: totalRevenue + ecommerceRevenue + walletTopups,
        commission,
        commissionPercent: 10,
        ecommerceRevenue,
        ecommerceOrders: nonCancelledOrders,
        ridesRevenue: totalRevenue,
        totalRides,
        completedRides,
        cancelledRides,
        activeRides,
        avgRidePrice,
        avgOrderPrice,
        completionRate,
        cancellationRate,
        avgRating,
        walletTopups,
        activeCustomers,
        activeDrivers,
        totalUsers,
        avgRidesPerDay:
          period === "day"
            ? totalRides
            : Math.round(totalRides / (period === "week" ? 7 : 30)),
      },
    });
  } catch (error) {
    console.error("[Analytics Routes] Erreur detailed stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
