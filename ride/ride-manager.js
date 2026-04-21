// Gestionnaire de courses en temps réel
class RideManager {
  constructor() {
    // Stockage en mémoire des courses actives
    this.activeRides = new Map();
    this.pendingRequests = new Map();
    this.driverSockets = new Map(); // Socket.io connections
  }

  // Créer une nouvelle demande de course
  createRideRequest(rideData) {
    const rideId = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const ride = {
      id: rideId,
      customerId: rideData.customerId,
      customerName: rideData.customerName,
      customerPhone: rideData.customerPhone,
      customerPhoto: rideData.customerPhoto,
      pickup: {
        latitude: rideData.pickup.latitude,
        longitude: rideData.pickup.longitude,
        address: rideData.pickup.address,
      },
      destination: {
        latitude: rideData.destination.latitude,
        longitude: rideData.destination.longitude,
        address: rideData.destination.address,
      },
      vehicleType: rideData.vehicleType,
      price: rideData.price,
      distance: rideData.distance,
      duration: rideData.duration,
      wodiCommission: Math.round(rideData.price * 0.1), // 10% commission
      driverEarning: Math.round(rideData.price * 0.9), // 90% pour le chauffeur
      status: "searching", // searching, accepted, picking_up, in_progress, completed, cancelled
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // Expire après 5 minutes
      notifiedDrivers: [],
      driverId: null,
      driverName: null,
      driverPhone: null,
      driverPhoto: null,
      driverVehicle: null,
      acceptedAt: null,
      pickedUpAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      rating: null,
      review: null,
    };

    this.pendingRequests.set(rideId, ride);

    // Auto-expiration après 5 minutes
    setTimeout(
      () => {
        if (this.pendingRequests.has(rideId)) {
          const ride = this.pendingRequests.get(rideId);
          if (ride.status === "searching") {
            ride.status = "expired";
            this.pendingRequests.delete(rideId);
            // Notifier le client que la recherche a expiré
            this.notifyCustomer(ride.customerId, "ride_expired", { rideId });
          }
        }
      },
      5 * 60 * 1000,
    );

    return ride;
  }

  // Trouver les chauffeurs disponibles à proximité
  findNearbyDrivers(pickup, maxDistance = 5000) {
    const driverLocationManager = require("../drivers/driver-location-manager");
    const onlineDrivers = driverLocationManager.getOnlineDrivers();

    console.log(
      `🔍 Recherche chauffeurs: ${onlineDrivers.length} chauffeur(s) en ligne`,
    );

    const nearbyDrivers = [];

    for (const driverData of onlineDrivers) {
      console.log(
        `   - Chauffeur ${driverData.driverId.substring(0, 8)}: status="${driverData.status}"`,
      );

      if (driverData.status !== "online") {
        console.log(`     ❌ Ignoré (status: ${driverData.status})`);
        continue; // Seulement les chauffeurs "actifs"
      }

      const distance = this.calculateDistance(
        pickup.latitude,
        pickup.longitude,
        driverData.location.lat,
        driverData.location.lng,
      );

      console.log(`     📏 Distance: ${Math.round(distance)}m`);

      if (distance <= maxDistance) {
        console.log(`     ✅ Ajouté (dans le rayon)`);
        nearbyDrivers.push({
          driverId: driverData.driverId,
          distance,
          location: driverData.location,
        });
      } else {
        console.log(`     ❌ Trop loin (max: ${maxDistance}m)`);
      }
    }

    // Trier par distance (plus proche en premier)
    nearbyDrivers.sort((a, b) => a.distance - b.distance);

    console.log(
      `✅ ${nearbyDrivers.length} chauffeur(s) disponible(s) trouvé(s)`,
    );

    return nearbyDrivers;
  }

  // Calculer la distance entre deux points (en mètres)
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Notifier les chauffeurs proches
  notifyNearbyDrivers(rideId) {
    const ride = this.pendingRequests.get(rideId);
    if (!ride) return { success: false, message: "Course introuvable" };

    const nearbyDrivers = this.findNearbyDrivers(ride.pickup, 5000); // 5km max

    console.log(
      `🔍 Recherche chauffeurs pour course ${rideId.substring(0, 8)}`,
    );
    console.log(
      `📍 ${nearbyDrivers.length} chauffeur(s) trouvé(s) à proximité`,
    );

    if (nearbyDrivers.length === 0) {
      return {
        success: false,
        message: "Aucun chauffeur disponible à proximité",
      };
    }

    // Notifier les 5 chauffeurs les plus proches
    const driversToNotify = nearbyDrivers.slice(0, 5);

    driversToNotify.forEach(({ driverId, distance }) => {
      ride.notifiedDrivers.push(driverId);
      console.log(
        `✉️ Notification envoyée au chauffeur ${driverId.substring(0, 8)} (${Math.round(distance)}m)`,
      );

      // Envoyer notification via Socket.io
      this.notifyDriver(driverId, "new_ride_request", {
        rideId: ride.id,
        customerName: ride.customerName,
        customerPhoto: ride.customerPhoto,
        pickup: ride.pickup,
        destination: ride.destination,
        price: ride.price,
        driverEarning: ride.driverEarning,
        wodiCommission: ride.wodiCommission,
        distance: ride.distance,
        duration: ride.duration,
        distanceToPickup: Math.round(distance),
        expiresAt: ride.expiresAt,
      });
    });

    console.log(
      `✅ ${driversToNotify.length} chauffeur(s) notifié(s) pour la course ${rideId.substring(0, 8)}`,
    );

    return {
      success: true,
      message: `${driversToNotify.length} chauffeur(s) notifié(s)`,
      driversNotified: driversToNotify.length,
    };
  }

  // Chauffeur accepte la course
  acceptRide(rideId, driverId, driverData) {
    const ride = this.pendingRequests.get(rideId);

    if (!ride) {
      return { success: false, message: "Course introuvable ou expirée" };
    }

    if (ride.status !== "searching") {
      return {
        success: false,
        message: "Un autre chauffeur a déjà accepté cette course",
      };
    }

    // Accepter la course
    ride.status = "accepted";
    ride.driverId = driverId;
    ride.driverName = driverData.driverName;
    ride.driverPhone = driverData.driverPhone;
    ride.driverPhoto = driverData.driverPhoto;
    ride.driverVehicle = driverData.driverVehicle;
    ride.driverRating = driverData.driverRating;
    ride.driverRatingCount = driverData.driverRatingCount;
    ride.acceptedAt = new Date();

    // Mettre le chauffeur en "busy" automatiquement
    const driverLocationManager = require("../drivers/driver-location-manager");
    const driver = driverLocationManager.getDriver(driverId);
    if (driver) {
      driver.status = "busy";
      console.log(
        `🚗 Chauffeur ${driverId.substring(0, 8)} mis en "busy" automatiquement`,
      );
    }

    // Déplacer vers les courses actives
    this.activeRides.set(rideId, ride);
    this.pendingRequests.delete(rideId);

    // Notifier le client
    this.notifyCustomer(ride.customerId, "ride_accepted", {
      rideId: ride.id,
      driver: {
        id: driverId,
        name: ride.driverName,
        phone: ride.driverPhone,
        photo: ride.driverPhoto,
        vehicle: ride.driverVehicle,
        rating: ride.driverRating,
        ratingCount: ride.driverRatingCount,
      },
    });

    // Notifier les autres chauffeurs que la course est prise
    ride.notifiedDrivers.forEach((id) => {
      if (id !== driverId) {
        this.notifyDriver(id, "ride_taken", { rideId });
      }
    });

    return { success: true, ride };
  }

  // Chauffeur commence le trajet vers le client
  startPickup(rideId, driverId) {
    const ride = this.activeRides.get(rideId);

    if (!ride || ride.driverId !== driverId) {
      return { success: false, message: "Course introuvable" };
    }

    if (ride.status !== "accepted") {
      return { success: false, message: "Statut invalide" };
    }

    ride.status = "picking_up";

    this.notifyCustomer(ride.customerId, "driver_coming", {
      rideId: ride.id,
      driver: {
        id: ride.driverId,
        name: ride.driverName,
        phone: ride.driverPhone,
      },
    });

    return { success: true, ride };
  }

  // Chauffeur confirme que le client est dans la voiture
  confirmPickup(rideId, driverId) {
    const ride = this.activeRides.get(rideId);

    if (!ride || ride.driverId !== driverId) {
      return { success: false, message: "Course introuvable" };
    }

    ride.status = "in_progress";
    ride.pickedUpAt = new Date();

    this.notifyCustomer(ride.customerId, "ride_started", {
      rideId: ride.id,
      pickedUpAt: ride.pickedUpAt,
    });

    return { success: true, ride };
  }

  // Chauffeur termine la course
  completeRide(rideId, driverId) {
    const ride = this.activeRides.get(rideId);

    if (!ride || ride.driverId !== driverId) {
      return { success: false, message: "Course introuvable" };
    }

    if (ride.status !== "in_progress") {
      return { success: false, message: "La course n'est pas en cours" };
    }

    ride.status = "completed";
    ride.completedAt = new Date();

    this.notifyCustomer(ride.customerId, "ride_completed", {
      rideId: ride.id,
      price: ride.price,
      completedAt: ride.completedAt,
    });

    return { success: true, ride };
  }

  // Annuler une course
  cancelRide(rideId, userId, userType) {
    let ride = this.pendingRequests.get(rideId) || this.activeRides.get(rideId);

    if (!ride) {
      return { success: false, message: "Course introuvable" };
    }

    // Le client ne peut pas annuler après que le chauffeur ait confirmé le pickup
    if (userType === "customer" && ride.status === "in_progress") {
      return {
        success: false,
        message: "Impossible d'annuler une course en cours",
      };
    }

    ride.status = "cancelled";
    ride.cancelledAt = new Date();
    ride.cancelledBy = userType;

    // Remettre le chauffeur en "online" s'il avait accepté la course
    if (ride.driverId) {
      const driverLocationManager = require("../drivers/driver-location-manager");
      const driver = driverLocationManager.getDriver(ride.driverId);
      if (driver && driver.status === "busy") {
        driver.status = "online";
        console.log(
          `🟢 Chauffeur ${ride.driverId.substring(0, 8)} remis en "online" après annulation`,
        );
      }
    }

    // Notifier l'autre partie
    if (userType === "customer" && ride.driverId) {
      this.notifyDriver(ride.driverId, "ride_cancelled", {
        rideId,
        cancelledBy: "customer",
      });
    } else if (userType === "driver") {
      this.notifyCustomer(ride.customerId, "ride_cancelled", {
        rideId,
        cancelledBy: "driver",
      });
    }

    // Supprimer des listes actives
    this.pendingRequests.delete(rideId);
    this.activeRides.delete(rideId);

    return { success: true, ride };
  }

  // Noter le chauffeur
  rateDriver(rideId, customerId, rating, review) {
    const ride = this.activeRides.get(rideId);

    if (!ride || ride.customerId !== customerId) {
      return { success: false, message: "Course introuvable" };
    }

    if (ride.status !== "completed") {
      return { success: false, message: "La course n'est pas terminée" };
    }

    ride.rating = rating;
    ride.review = review;

    return { success: true, ride };
  }

  // Obtenir une course
  getRide(rideId) {
    return this.pendingRequests.get(rideId) || this.activeRides.get(rideId);
  }

  // Méthodes de notification (à implémenter avec Socket.io)
  notifyDriver(driverId, event, data) {
    const socket = this.driverSockets.get(driverId);
    if (socket) {
      socket.emit(event, data);
    }
  }

  notifyCustomer(customerId, event, data) {
    // À implémenter avec Socket.io
    console.log(`Notify customer ${customerId}:`, event, data);
  }

  // Enregistrer une connexion Socket.io
  registerDriverSocket(driverId, socket) {
    this.driverSockets.set(driverId, socket);
  }

  unregisterDriverSocket(driverId) {
    this.driverSockets.delete(driverId);
  }

  // Récupérer la demande en attente pour un chauffeur spécifique
  getPendingRequestForDriver(driverId) {
    // Parcourir toutes les demandes en attente
    for (const [rideId, ride] of this.pendingRequests.entries()) {
      // Vérifier si ce chauffeur a été notifié
      if (ride.notifiedDrivers && ride.notifiedDrivers.includes(driverId)) {
        // Vérifier que la demande n'a pas expiré
        if (new Date() < ride.expiresAt) {
          return {
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
            distanceToPickup: ride.distanceToPickup,
            expiresAt: ride.expiresAt,
          };
        }
      }
    }

    return null;
  }
}

module.exports = new RideManager();
