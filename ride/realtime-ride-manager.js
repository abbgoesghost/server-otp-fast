const admin = require("../config/firebase-admin");
const DriverLocationManager = require("../drivers/driver-location-manager");

class RealtimeRideManager {
  constructor() {
    this.db = admin.database();
    this.ridesRef = this.db.ref("rides");

    // Nettoyer les courses expirées toutes les 10 secondes
    setInterval(() => {
      this.cleanExpiredRides();
    }, 10000);
  }

  // Créer une nouvelle demande de course
  async createRide(rideData) {
    try {
      const rideId = this.db.ref().push().key;
      const now = Date.now();
      const expiresAt = now + 3 * 60 * 1000; // 3 minutes

      const ride = {
        id: rideId,
        status: "searching",
        takenBy: null,
        customerId: rideData.customerId,
        customerName: rideData.customerName,
        customerPhone: rideData.customerPhone,
        customerPhoto: rideData.customerPhoto || null,
        pickup: rideData.pickup,
        destination: rideData.destination,
        vehicleType: rideData.vehicleType,
        price: rideData.price,
        distance: rideData.distance,
        duration: rideData.duration,
        wodiCommission: rideData.wodiCommission,
        driverEarning: rideData.driverEarning,
        notifiedDrivers: rideData.notifiedDrivers || [],
        paymentMethod: rideData.paymentMethod || "cash",
        paymentStatus: "pending",
        createdAt: now,
        expiresAt: expiresAt,
      };

      await this.ridesRef.child(rideId).set(ride);

      console.log(`[RealtimeRide] ✅ Course créée: ${rideId}`);

      return { success: true, rideId, ride };
    } catch (error) {
      console.error("[RealtimeRide] Erreur création course:", error);
      return { success: false, error: error.message };
    }
  }

  // Chauffeur accepte la course
  async acceptRide(rideId, driverId, driverData) {
    try {
      const rideSnapshot = await this.ridesRef.child(rideId).once("value");
      const ride = rideSnapshot.val();

      if (!ride) {
        return { success: false, message: "Course introuvable" };
      }

      if (ride.status === "taken") {
        return { success: false, message: "Course déjà prise" };
      }

      if (ride.status === "cancelled") {
        return { success: false, message: "Course annulée" };
      }

      // Sanitize vehicle data - Firebase doesn't accept undefined values
      const sanitizedVehicle = driverData.vehicle
        ? {
            type: driverData.vehicle.type || null,
            model: driverData.vehicle.model || null,
            plate: driverData.vehicle.plate || null,
            color: driverData.vehicle.color || null,
          }
        : null;

      // Marquer comme prise
      await this.ridesRef.child(rideId).update({
        status: "taken",
        takenBy: driverId,
        driverName: driverData.name || null,
        driverPhone: driverData.phone || null,
        driverPhoto: driverData.photo || null,
        driverVehicle: sanitizedVehicle,
        driverRating: driverData.rating || null,
        driverRatingCount: driverData.ratingCount || null,
        acceptedAt: Date.now(),
      });

      // Mettre le chauffeur en "busy"
      DriverLocationManager.updateDriverStatus(driverId, "busy");

      console.log(
        `[RealtimeRide] ✅ Course ${rideId} acceptée par ${driverId}`,
      );

      const updatedSnapshot = await this.ridesRef.child(rideId).once("value");
      return { success: true, ride: updatedSnapshot.val() };
    } catch (error) {
      console.error("[RealtimeRide] Erreur acceptation:", error);
      return { success: false, error: error.message };
    }
  }

  // Annuler une course
  async cancelRide(rideId, userId, userType) {
    try {
      const rideSnapshot = await this.ridesRef.child(rideId).once("value");
      const ride = rideSnapshot.val();

      if (!ride) {
        return { success: false, message: "Course introuvable" };
      }

      await this.ridesRef.child(rideId).update({
        status: "cancelled",
        cancelledBy: userId,
        cancelledAt: Date.now(),
      });

      // Si un chauffeur avait accepté, le remettre en "online"
      if (ride.takenBy) {
        DriverLocationManager.updateDriverStatus(ride.takenBy, "online");
      }

      console.log(`[RealtimeRide] ✅ Course ${rideId} annulée par ${userId}`);

      return { success: true };
    } catch (error) {
      console.error("[RealtimeRide] Erreur annulation:", error);
      return { success: false, error: error.message };
    }
  }

  // Confirmer le pickup
  async confirmPickup(rideId, driverId) {
    try {
      const rideSnapshot = await this.ridesRef.child(rideId).once("value");
      const ride = rideSnapshot.val();

      if (!ride || ride.takenBy !== driverId) {
        return { success: false, message: "Non autorisé" };
      }

      await this.ridesRef.child(rideId).update({
        status: "in_progress",
        pickedUpAt: Date.now(),
      });

      console.log(`[RealtimeRide] ✅ Pickup confirmé pour ${rideId}`);

      return { success: true };
    } catch (error) {
      console.error("[RealtimeRide] Erreur pickup:", error);
      return { success: false, error: error.message };
    }
  }

  // Terminer la course
  async completeRide(rideId, driverId) {
    try {
      const rideSnapshot = await this.ridesRef.child(rideId).once("value");
      const ride = rideSnapshot.val();

      if (!ride || ride.takenBy !== driverId) {
        return { success: false, message: "Non autorisé" };
      }

      await this.ridesRef.child(rideId).update({
        status: "completed",
        completedAt: Date.now(),
      });

      // Remettre le chauffeur en "online"
      DriverLocationManager.updateDriverStatus(driverId, "online");

      console.log(`[RealtimeRide] ✅ Course ${rideId} terminée`);

      return { success: true };
    } catch (error) {
      console.error("[RealtimeRide] Erreur completion:", error);
      return { success: false, error: error.message };
    }
  }

  // Récupérer une course
  async getRide(rideId) {
    try {
      const snapshot = await this.ridesRef.child(rideId).once("value");
      const ride = snapshot.val();

      if (!ride) {
        return { success: false, message: "Course introuvable" };
      }

      return { success: true, ride };
    } catch (error) {
      console.error("[RealtimeRide] Erreur récupération:", error);
      return { success: false, error: error.message };
    }
  }

  // Nettoyer les courses expirées
  async cleanExpiredRides() {
    try {
      const now = Date.now();
      const snapshot = await this.ridesRef
        .orderByChild("status")
        .equalTo("searching")
        .once("value");

      const rides = snapshot.val();
      if (!rides) return;

      const updates = {};

      Object.keys(rides).forEach((rideId) => {
        const ride = rides[rideId];
        if (ride.expiresAt < now) {
          console.log(`[RealtimeRide] ⏰ Course expirée: ${rideId}`);
          updates[`${rideId}/status`] = "cancelled";
          updates[`${rideId}/cancelledAt`] = now;
          updates[`${rideId}/cancelledBy`] = "system";
        }
      });

      if (Object.keys(updates).length > 0) {
        await this.ridesRef.update(updates);
        console.log(
          `[RealtimeRide] ✅ ${Object.keys(updates).length / 3} courses expirées nettoyées`,
        );
      }
    } catch (error) {
      console.error("[RealtimeRide] Erreur nettoyage:", error);
    }
  }

  // Obtenir les courses en recherche pour un chauffeur
  async getSearchingRides(driverId) {
    try {
      const snapshot = await this.ridesRef
        .orderByChild("status")
        .equalTo("searching")
        .once("value");

      const rides = snapshot.val();
      if (!rides) {
        return { success: true, rides: [] };
      }

      // Filtrer les courses où le chauffeur a été notifié
      const driverRides = Object.values(rides).filter(
        (ride) =>
          ride.notifiedDrivers && ride.notifiedDrivers.includes(driverId),
      );

      return { success: true, rides: driverRides };
    } catch (error) {
      console.error("[RealtimeRide] Erreur récupération courses:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new RealtimeRideManager();
