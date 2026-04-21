const admin = require("../config/firebase-admin");

class CustomerLocationManager {
  constructor() {
    this.customers = new Map();
    this.db = admin.firestore();
    this.startLocationBroadcast();
    this.startPingCheck();
  }

  async updateCustomerLocation(customerId, location, heading = 0) {
    const timestamp = Date.now();

    this.customers.set(customerId, {
      customerId,
      location,
      heading,
      lastUpdate: timestamp,
      lastPing: timestamp,
    });

    try {
      const customerDoc = await this.db
        .collection("users")
        .doc(customerId)
        .get();
      const customerData = customerDoc.exists ? customerDoc.data() : {};

      return {
        customerId,
        location,
        heading,
        timestamp,
        firstName: customerData.firstName || "Client",
        lastName: customerData.lastName || "",
        phoneNumber: customerData.phoneNumber || "",
      };
    } catch (error) {
      console.error("Erreur récupération infos customer:", error);
      return {
        customerId,
        location,
        heading,
        timestamp,
      };
    }
  }

  getAllCustomers() {
    const now = Date.now();
    const activeCustomers = [];

    for (const [customerId, data] of this.customers.entries()) {
      if (now - data.lastPing < 90000) {
        activeCustomers.push({
          customerId: data.customerId,
          location: data.location,
          heading: data.heading,
          lastUpdate: data.lastUpdate,
        });
      }
    }

    return activeCustomers;
  }

  getNearbyCustomers(centerLat, centerLng, radiusKm = 10) {
    const customers = this.getAllCustomers();

    return customers.filter((customer) => {
      const distance = this.calculateDistance(
        centerLat,
        centerLng,
        customer.location.lat,
        customer.location.lng,
      );
      return distance <= radiusKm;
    });
  }

  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  startLocationBroadcast() {
    setInterval(() => {
      const customers = this.getAllCustomers();
      console.log(`📍 ${customers.length} customers actifs`);
    }, 2000);
  }

  startPingCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const [customerId, data] of this.customers.entries()) {
        if (now - data.lastPing > 90000) {
          console.log(`❌ Customer ${customerId} hors ligne`);
          this.customers.delete(customerId);
        }
      }
    }, 30000);
  }

  async setCustomerOffline(customerId) {
    this.customers.delete(customerId);
  }

  getCustomerStatus(customerId) {
    return this.customers.has(customerId) ? "online" : "offline";
  }

  stop() {
    this.customers.clear();
  }
}

module.exports = CustomerLocationManager;
