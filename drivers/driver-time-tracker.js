/**
 * Driver Time Tracker
 * Tracks time spent in different statuses: online (active), busy, in_ride
 */

const admin = require("../config/firebase-admin");

class DriverTimeTracker {
  constructor() {
    // En mémoire: { driverId: { status, startTime, totalTimes: { active, busy, in_ride } } }
    this.activeSessions = new Map();
  }

  /**
   * Démarrer le tracking pour un driver
   */
  startTracking(driverId, status) {
    const now = Date.now();

    if (this.activeSessions.has(driverId)) {
      // Si déjà en tracking, sauvegarder le temps du statut précédent
      this.updateTime(driverId);
    }

    this.activeSessions.set(driverId, {
      status: status,
      startTime: now,
      totalTimes: this.activeSessions.get(driverId)?.totalTimes || {
        active: 0,
        busy: 0,
        in_ride: 0,
      },
    });

    console.log(
      `[TimeTracker] ⏱️  ${driverId} - Démarrage tracking: ${status}`,
    );
  }

  /**
   * Changer le statut d'un driver
   */
  changeStatus(driverId, newStatus) {
    if (!this.activeSessions.has(driverId)) {
      this.startTracking(driverId, newStatus);
      return;
    }

    // Sauvegarder le temps du statut actuel
    this.updateTime(driverId);

    // Changer le statut
    const session = this.activeSessions.get(driverId);
    session.status = newStatus;
    session.startTime = Date.now();

    console.log(`[TimeTracker] 🔄 ${driverId} - Changement: ${newStatus}`);
  }

  /**
   * Mettre à jour le temps accumulé pour le statut actuel
   */
  updateTime(driverId) {
    const session = this.activeSessions.get(driverId);
    if (!session) return;

    const now = Date.now();
    const elapsed = now - session.startTime;

    // Ajouter le temps au statut correspondant
    if (session.status === "active") {
      session.totalTimes.active += elapsed;
    } else if (session.status === "busy") {
      session.totalTimes.busy += elapsed;
    } else if (session.status === "in_ride") {
      session.totalTimes.in_ride += elapsed;
    }

    // Réinitialiser le startTime
    session.startTime = now;
  }

  /**
   * Arrêter le tracking et sauvegarder dans Firestore
   */
  async stopTracking(driverId) {
    if (!this.activeSessions.has(driverId)) return;

    // Mettre à jour une dernière fois
    this.updateTime(driverId);

    const session = this.activeSessions.get(driverId);
    const totalTimes = session.totalTimes;

    // Sauvegarder dans Firestore
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const docId = `${driverId}_${today.getTime()}`;

      await admin
        .firestore()
        .collection("driver_time_logs")
        .doc(docId)
        .set(
          {
            driverId: driverId,
            date: admin.firestore.Timestamp.fromDate(today),
            times: {
              active: admin.firestore.FieldValue.increment(
                Math.floor(totalTimes.active / 1000),
              ), // en secondes
              busy: admin.firestore.FieldValue.increment(
                Math.floor(totalTimes.busy / 1000),
              ),
              in_ride: admin.firestore.FieldValue.increment(
                Math.floor(totalTimes.in_ride / 1000),
              ),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      console.log(
        `[TimeTracker] 💾 ${driverId} - Sauvegardé: Active=${Math.floor(totalTimes.active / 1000)}s, Busy=${Math.floor(totalTimes.busy / 1000)}s, InRide=${Math.floor(totalTimes.in_ride / 1000)}s`,
      );
    } catch (error) {
      console.error("[TimeTracker] Erreur sauvegarde:", error);
    }

    // Supprimer de la mémoire
    this.activeSessions.delete(driverId);
  }

  /**
   * Obtenir les temps pour une période
   */
  async getTimesForPeriod(driverId, startDate, endDate) {
    try {
      const snapshot = await admin
        .firestore()
        .collection("driver_time_logs")
        .where("driverId", "==", driverId)
        .where("date", ">=", admin.firestore.Timestamp.fromDate(startDate))
        .where("date", "<=", admin.firestore.Timestamp.fromDate(endDate))
        .get();

      let totalActive = 0;
      let totalBusy = 0;
      let totalInRide = 0;

      snapshot.forEach((doc) => {
        const data = doc.data();
        totalActive += data.times?.active || 0;
        totalBusy += data.times?.busy || 0;
        totalInRide += data.times?.in_ride || 0;
      });

      return {
        active: totalActive,
        busy: totalBusy,
        in_ride: totalInRide,
        total: totalActive + totalBusy + totalInRide,
      };
    } catch (error) {
      console.error("[TimeTracker] Erreur récupération temps:", error);
      return { active: 0, busy: 0, in_ride: 0, total: 0 };
    }
  }

  /**
   * Obtenir les temps par jour pour une semaine
   */
  async getWeeklyTimes(driverId, weekStart) {
    try {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const snapshot = await admin
        .firestore()
        .collection("driver_time_logs")
        .where("driverId", "==", driverId)
        .where("date", ">=", admin.firestore.Timestamp.fromDate(weekStart))
        .where("date", "<", admin.firestore.Timestamp.fromDate(weekEnd))
        .get();

      const weekData = {};
      for (let i = 0; i < 7; i++) {
        weekData[i] = { active: 0, busy: 0, in_ride: 0 };
      }

      snapshot.forEach((doc) => {
        const data = doc.data();
        const date = data.date.toDate();
        const dayIndex = (date.getDay() + 6) % 7; // Lundi = 0

        weekData[dayIndex] = {
          active: data.times?.active || 0,
          busy: data.times?.busy || 0,
          in_ride: data.times?.in_ride || 0,
        };
      });

      return weekData;
    } catch (error) {
      console.error("[TimeTracker] Erreur récupération semaine:", error);
      return {};
    }
  }

  /**
   * Sauvegarder périodiquement (toutes les 5 minutes)
   */
  startPeriodicSave() {
    setInterval(
      () => {
        for (const [driverId] of this.activeSessions) {
          this.updateTime(driverId);
          // Sauvegarder sans arrêter le tracking
          this.saveCurrentSession(driverId);
        }
      },
      5 * 60 * 1000,
    ); // 5 minutes
  }

  async saveCurrentSession(driverId) {
    const session = this.activeSessions.get(driverId);
    if (!session) return;

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const docId = `${driverId}_${today.getTime()}`;

      await admin
        .firestore()
        .collection("driver_time_logs")
        .doc(docId)
        .set(
          {
            driverId: driverId,
            date: admin.firestore.Timestamp.fromDate(today),
            times: {
              active: Math.floor(session.totalTimes.active / 1000),
              busy: Math.floor(session.totalTimes.busy / 1000),
              in_ride: Math.floor(session.totalTimes.in_ride / 1000),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    } catch (error) {
      console.error("[TimeTracker] Erreur sauvegarde périodique:", error);
    }
  }
}

// Instance singleton
const timeTracker = new DriverTimeTracker();

// Démarrer la sauvegarde périodique
timeTracker.startPeriodicSave();

module.exports = timeTracker;
