class DriverLocationManager {
  constructor() {
    this.drivers = new Map(); // driverId -> { location, heading, status, lastUpdate }
    this.OFFLINE_TIMEOUT = 30000; // 30 secondes sans update = offline
  }

  // Mettre à jour la localisation d'un chauffeur
  updateDriverLocation(driverId, location, heading, status = "online") {
    const now = Date.now();

    this.drivers.set(driverId, {
      driverId,
      location: {
        lat: location.lat,
        lng: location.lng,
      },
      heading: heading || 0, // Direction en degrés (0 = Nord)
      status, // online, offline, busy
      lastUpdate: now,
    });

    console.log(
      `📍 Driver ${driverId.substring(0, 8)} - Position: ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)} - Heading: ${heading}° - Status: ${status}`,
    );

    // Nettoyer les chauffeurs offline
    this.cleanOfflineDrivers();

    return {
      success: true,
      driver: this.drivers.get(driverId),
    };
  }

  // Récupérer tous les chauffeurs en ligne
  getOnlineDrivers() {
    this.cleanOfflineDrivers();

    const onlineDrivers = [];
    for (const driver of this.drivers.values()) {
      if (driver.status === "online" || driver.status === "busy") {
        onlineDrivers.push(driver);
      }
    }

    return onlineDrivers;
  }

  // Récupérer un chauffeur spécifique
  getDriver(driverId) {
    return this.drivers.get(driverId) || null;
  }

  // Alias pour récupérer la position d'un chauffeur
  getDriverLocation(driverId) {
    return this.getDriver(driverId);
  }

  // Mettre un chauffeur offline
  setDriverOffline(driverId) {
    const driver = this.drivers.get(driverId);
    if (driver) {
      driver.status = "offline";
      driver.lastUpdate = Date.now();
      console.log(
        `🔴 Driver ${driverId.substring(0, 8)} est maintenant offline`,
      );
    }
    return { success: true };
  }

  // Nettoyer les chauffeurs qui n'ont pas envoyé de mise à jour récemment
  cleanOfflineDrivers() {
    const now = Date.now();
    const driversToRemove = [];

    for (const [driverId, driver] of this.drivers.entries()) {
      if (now - driver.lastUpdate > this.OFFLINE_TIMEOUT) {
        driversToRemove.push(driverId);
      }
    }

    driversToRemove.forEach((driverId) => {
      console.log(
        `🗑️ Suppression driver ${driverId.substring(0, 8)} (timeout)`,
      );
      this.drivers.delete(driverId);
    });
  }

  // Récupérer les chauffeurs à proximité
  getNearbyDrivers(lat, lng, radiusKm = 5) {
    this.cleanOfflineDrivers();

    const nearbyDrivers = [];

    for (const driver of this.drivers.values()) {
      if (driver.status === "online") {
        const distance = this.calculateDistance(
          lat,
          lng,
          driver.location.lat,
          driver.location.lng,
        );

        if (distance <= radiusKm) {
          nearbyDrivers.push({
            ...driver,
            distance: distance,
          });
        }
      }
    }

    // Trier par distance
    nearbyDrivers.sort((a, b) => a.distance - b.distance);

    return nearbyDrivers;
  }

  // Alias pour compatibilité
  findNearbyDrivers(lat, lng, radiusMeters = 5000, maxDrivers = 5) {
    const radiusKm = radiusMeters / 1000;
    const nearby = this.getNearbyDrivers(lat, lng, radiusKm);

    // Limiter au nombre max et formater pour correspondre à l'ancien format
    return nearby.slice(0, maxDrivers).map((driver) => ({
      id: driver.driverId,
      location: driver.location,
      heading: driver.heading,
      status: driver.status,
      distance: driver.distance * 1000, // Convertir en mètres
    }));
  }

  // Mettre à jour le statut d'un chauffeur
  updateDriverStatus(driverId, status) {
    const driver = this.drivers.get(driverId);
    if (driver) {
      driver.status = status;
      driver.lastUpdate = Date.now();
      console.log(
        `🚗 Chauffeur ${driverId.substring(0, 8)} mis en "${status}" automatiquement`,
      );
      return { success: true };
    }
    return { success: false, message: "Chauffeur introuvable" };
  }

  // Calculer la distance entre deux points (Haversine)
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Obtenir le nombre de chauffeurs en ligne
  getOnlineCount() {
    this.cleanOfflineDrivers();
    let count = 0;
    for (const driver of this.drivers.values()) {
      if (driver.status === "online" || driver.status === "busy") {
        count++;
      }
    }
    return count;
  }
}

// Créer et exporter une instance singleton
module.exports = new DriverLocationManager();
