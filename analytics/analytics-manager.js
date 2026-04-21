const admin = require("firebase-admin");

class AnalyticsManager {
  constructor() {
    this.db = admin.firestore();
    this.realtimeDb = admin.database();
  }

  /**
   * Enregistrer une session utilisateur active
   */
  async trackActiveUser(userId, userType, deviceInfo = {}) {
    try {
      const sessionData = {
        userId,
        userType, // "customer" ou "driver"
        deviceInfo,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
      };

      // Firestore pour l'historique
      await this.db.collection("activeSessions").doc(userId).set(sessionData, {
        merge: true,
      });

      // Realtime DB pour le tracking en temps réel
      await this.realtimeDb.ref(`activeSessions/${userId}`).set({
        userType,
        lastSeen: Date.now(),
        isActive: true,
      });

      console.log(`[Analytics] 👤 Utilisateur actif: ${userType} ${userId}`);

      return { success: true };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur track user:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer un utilisateur comme inactif
   */
  async markUserInactive(userId) {
    try {
      await this.db.collection("activeSessions").doc(userId).update({
        isActive: false,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      });

      await this.realtimeDb.ref(`activeSessions/${userId}`).update({
        isActive: false,
        lastSeen: Date.now(),
      });

      return { success: true };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur mark inactive:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtenir les statistiques globales
   */
  async getGlobalStats() {
    try {
      // Utilisateurs actifs
      const activeSessionsSnapshot = await this.db
        .collection("activeSessions")
        .where("isActive", "==", true)
        .get();

      const activeCustomers = activeSessionsSnapshot.docs.filter(
        (doc) => doc.data().userType === "customer",
      ).length;
      const activeDrivers = activeSessionsSnapshot.docs.filter(
        (doc) => doc.data().userType === "driver",
      ).length;

      // Total utilisateurs
      const usersSnapshot = await this.db.collection("users").get();
      const totalCustomers = usersSnapshot.docs.filter(
        (doc) => doc.data().userType === "customer",
      ).length;
      const totalDrivers = usersSnapshot.docs.filter(
        (doc) => doc.data().userType === "driver",
      ).length;

      // Courses
      const ridesSnapshot = await this.realtimeDb.ref("rides").once("value");
      const rides = ridesSnapshot.val() || {};
      const ridesArray = Object.values(rides);

      const totalRides = ridesArray.length;
      const completedRides = ridesArray.filter(
        (r) => r.status === "completed",
      ).length;
      const activeRides = ridesArray.filter(
        (r) => r.status === "accepted" || r.status === "in_progress",
      ).length;
      const cancelledRides = ridesArray.filter(
        (r) => r.status === "cancelled",
      ).length;

      // Revenus
      const completedRidesData = ridesArray.filter(
        (r) => r.status === "completed",
      );
      const totalRevenue = completedRidesData.reduce(
        (sum, r) => sum + (r.price || 0),
        0,
      );
      const wodiCommission = completedRidesData.reduce(
        (sum, r) => sum + (r.wodiCommission || 0),
        0,
      );
      const driverEarnings = completedRidesData.reduce(
        (sum, r) => sum + (r.driverEarning || 0),
        0,
      );

      // Transactions wallet
      const transactionsSnapshot = await this.db
        .collection("transactions")
        .get();
      const transactions = transactionsSnapshot.docs.map((doc) => doc.data());

      const totalDeposits = transactions
        .filter((t) => t.type === "deposit")
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const totalWithdrawals = transactions
        .filter((t) => t.type === "withdrawal")
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      return {
        success: true,
        stats: {
          users: {
            activeCustomers,
            activeDrivers,
            totalCustomers,
            totalDrivers,
            totalActive: activeCustomers + activeDrivers,
            totalUsers: totalCustomers + totalDrivers,
          },
          rides: {
            total: totalRides,
            completed: completedRides,
            active: activeRides,
            cancelled: cancelledRides,
            completionRate:
              totalRides > 0
                ? ((completedRides / totalRides) * 100).toFixed(1)
                : 0,
          },
          revenue: {
            total: totalRevenue,
            wodiCommission,
            driverEarnings,
            averageRidePrice:
              completedRides > 0
                ? (totalRevenue / completedRides).toFixed(0)
                : 0,
          },
          wallet: {
            totalDeposits,
            totalWithdrawals,
            balance: totalDeposits - totalWithdrawals,
          },
        },
      };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur stats globales:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtenir les statistiques par période
   */
  async getStatsByPeriod(period = "today") {
    try {
      let startDate;
      const now = new Date();

      switch (period) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        default:
          startDate = new Date(now.setHours(0, 0, 0, 0));
      }

      // Courses de la période
      const ridesSnapshot = await this.realtimeDb.ref("rides").once("value");
      const rides = ridesSnapshot.val() || {};
      const ridesArray = Object.values(rides).filter((r) => {
        const rideDate = new Date(r.createdAt);
        return rideDate >= startDate;
      });

      const completedRides = ridesArray.filter((r) => r.status === "completed");
      const revenue = completedRides.reduce(
        (sum, r) => sum + (r.price || 0),
        0,
      );
      const commission = completedRides.reduce(
        (sum, r) => sum + (r.wodiCommission || 0),
        0,
      );

      // Transactions de la période
      const transactionsSnapshot = await this.db
        .collection("transactions")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startDate))
        .get();

      const deposits = transactionsSnapshot.docs
        .filter((doc) => doc.data().type === "deposit")
        .reduce((sum, doc) => sum + (doc.data().amount || 0), 0);

      return {
        success: true,
        period,
        stats: {
          rides: ridesArray.length,
          completed: completedRides.length,
          revenue,
          commission,
          deposits,
        },
      };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur stats période:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtenir les données pour les charts
   */
  async getChartData(type = "revenue", period = "week") {
    try {
      const days = period === "week" ? 7 : 30;
      const data = [];

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        // Courses du jour
        const ridesSnapshot = await this.realtimeDb.ref("rides").once("value");
        const rides = ridesSnapshot.val() || {};
        const dayRides = Object.values(rides).filter((r) => {
          const rideDate = new Date(r.createdAt);
          return rideDate >= date && rideDate < nextDate;
        });

        const completedRides = dayRides.filter((r) => r.status === "completed");

        let value = 0;
        if (type === "revenue") {
          value = completedRides.reduce((sum, r) => sum + (r.price || 0), 0);
        } else if (type === "rides") {
          value = completedRides.length;
        } else if (type === "commission") {
          value = completedRides.reduce(
            (sum, r) => sum + (r.wodiCommission || 0),
            0,
          );
        }

        data.push({
          date: date.toISOString().split("T")[0],
          value,
        });
      }

      return {
        success: true,
        type,
        period,
        data,
      };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur chart data:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Obtenir les courses actives avec détails
   */
  async getActiveRidesDetails() {
    try {
      const ridesSnapshot = await this.realtimeDb.ref("rides").once("value");
      const rides = ridesSnapshot.val() || {};

      const activeRides = Object.entries(rides)
        .filter(
          ([_, ride]) =>
            ride.status === "accepted" || ride.status === "in_progress",
        )
        .map(([rideId, ride]) => ({
          rideId,
          ...ride,
        }));

      return {
        success: true,
        rides: activeRides,
      };
    } catch (error) {
      console.error("[Analytics] ❌ Erreur active rides:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AnalyticsManager();
