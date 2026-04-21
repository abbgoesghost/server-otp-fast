const admin = require("firebase-admin");

class PresenceManager {
  constructor() {
    this.db = admin.database();
    this.presenceRef = this.db.ref("presence");
    this.PING_INTERVAL = 60000;
    this.TIMEOUT_THRESHOLD = 90000;
    this.startPresenceMonitoring();
  }

  startPresenceMonitoring() {
    console.log("🔄 Démarrage du monitoring de présence...");

    setInterval(() => {
      this.checkDriversPresence();
    }, this.PING_INTERVAL);
  }

  async checkDriversPresence() {
    try {
      const snapshot = await this.presenceRef.once("value");
      const drivers = snapshot.val();

      if (!drivers) return;

      const now = Date.now();

      for (const [driverId, driverData] of Object.entries(drivers)) {
        const lastSeen = driverData.lastSeen || 0;
        const timeSinceLastSeen = now - lastSeen;

        if (
          timeSinceLastSeen > this.TIMEOUT_THRESHOLD &&
          driverData.status !== "offline"
        ) {
          console.log(
            `⚠️ Chauffeur ${driverId} inactif depuis ${Math.round(timeSinceLastSeen / 1000)}s - Mise hors ligne`,
          );
          await this.setDriverOffline(driverId);
        }
      }
    } catch (error) {
      console.error("❌ Erreur monitoring présence:", error);
    }
  }

  async setDriverOffline(driverId) {
    try {
      await this.presenceRef.child(driverId).update({
        status: "offline",
        lastStatusChange: Date.now(),
      });
    } catch (error) {
      console.error(`❌ Erreur mise offline ${driverId}:`, error);
    }
  }

  async updateDriverPresence(driverId, status) {
    try {
      await this.presenceRef.child(driverId).set({
        status: status,
        lastSeen: Date.now(),
        lastStatusChange: Date.now(),
      });
      console.log(`✅ Présence mise à jour: ${driverId} - ${status}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ Erreur update présence ${driverId}:`, error);
      return { success: false, error: error.message };
    }
  }

  async getDriverPresence(driverId) {
    try {
      const snapshot = await this.presenceRef.child(driverId).once("value");
      return snapshot.val();
    } catch (error) {
      console.error(`❌ Erreur get présence ${driverId}:`, error);
      return null;
    }
  }

  async heartbeat(driverId) {
    try {
      const driverData = await this.getDriverPresence(driverId);

      if (!driverData) {
        await this.updateDriverPresence(driverId, "offline");
        return { success: true, status: "offline" };
      }

      await this.presenceRef.child(driverId).update({
        lastSeen: Date.now(),
      });

      return { success: true, status: driverData.status };
    } catch (error) {
      console.error(`❌ Erreur heartbeat ${driverId}:`, error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = PresenceManager;
